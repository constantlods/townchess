# Visual judge report (stage 2)

Date: 2026-10-04. First run, so there is no previous report. The "since" column compares against
`00-baseline.png` (where the project started) and `22-reference-pass.png` (the previous pass).
Judged images: `27-main.png` (player view), `27-board-closeup.png`, `27-opponent-closeup.png`, `12-annotator.png`
(older), the reference `/root/townchess-work/reference-northstar.png` (main panel, 0..1045 x 0..685).
Owner demand weighted in: AAA detail ("blood on the board", "veins in the hands"), free assets or code only.

## Findings first (evidence)

1. **The 27 close-up of the opponent is not new.** `27-opponent-closeup.png` is byte-identical to
   `23-opponent-closeup-cinematic.png` (md5 `27e1eb4b...`). The opponent row below can't show progress since 23.
   Capture a fresh one.
2. **The frame is one hue.** Measured on 1/4-scale crops: 27-main has mean saturation 189/255 against the
   reference's 150. The player's right hand is at 241/255 (the reference hand is 166), so it is almost pure orange.
   The scene has no colour grading at all: the post settings in `build()` (build_scene.py ~1518-1530) set only
   exposure, bloom, vignette and grain. The lamp is at 2400 K, and `Lamp_TableBounce` adds more 2600 K light.
3. **The board is blown out.** Its crop has mean luma 110 and 11.7% clipped pixels. The reference board has luma 55
   and no clipping. The board close-up has 13.9% clipped pixels. The cause is the baked `T_Board_BaseColor.jpg`:
   maple squares sample sRGB (194,151,96), and walnut samples (47,14,5) at saturation 227, which is maroon rather
   than walnut. `MI_BoardSquares` (build_scene.py ~1115) applies no tint, so this full albedo sits under a 700 lm
   key.
4. **One blood mark reads as a red UI square.** In both 27 shots, a flat, candy-red rectangle covers about 2 squares
   on rank 6, with straight edges. `blood_decals()` (~431) has no edge fade, unlike the unused
   `blood_decal_material()` whose docstring promises one. Its normal and relief are disconnected (~461), and
   `Darken` stays 1.0. The generator's fresh-red colour is therefore projected flat, with no rim, cracks or
   thickness. The spatter at d5/e5 does read as blood in the close-up, and that part is good.
5. **The player hands look like wax.** The skin shows no veins, dirt, nail detail or blood. The 27-main image also
   shows ordered-dither or posterization dots on the hands and lamp shade. The likely cause is the 8-bit readback
   of `ShotCapture` (`SCS_FINAL_TONE_CURVE_HDR`, ~1510); check it before judging skin detail. The left hand is a
   raised fist beside the lamp base, not resting on the board frame. No sleeve or cuff is visible.
6. **The HUD is missing from every capture.** `ATCHUD` exists (TCGame.cpp ~388), but the SceneCapture does not
   draw the HUD. UI can't be judged.
7. **There is no Black-seat screenshot.** Commit 6f6cff1 says the board turns 180° for Black. This is unverified
   visually, so treat it as a gap.

## Scores (0-10 vs reference)

| Element | Score | vs 00-baseline | vs 22 (previous) | Note |
|---|---|---|---|---|
| Opponent: face | 6 | much better | same (shot is a copy) | Real MetaHuman face, eyes and wrinkles visible through the cage. Head tipped back, looking at the ceiling |
| Opponent: body/pose | 3 | better | same | Upright, arms crossed on the chest, far from the table. The reference leans in with elbows on the table and fingers laced at the chin |
| Opponent: clothing | 2 | better | same | Clean default T-shirt with a flat tint. The reference has a filthy canvas straitjacket shirt, straps and a leather wrist cuff |
| Mask (cage) | 5 | much better | same | Right silhouette. Bars are flat paper-thin ribbons with one uniform orange rust. No round wire, rivets or brow band, and it isn't dark iron |
| Player hands | 3 | better (skin, not chrome) | better (lit, not silhouettes) | Waxy and saturated orange. No veins, dirt, nails or blood. Left-hand pose is wrong, and there is no sleeve or cuff |
| Pieces | 5 | better | slightly better (speckle gone) | Good Staunton shapes, and the black pieces have a nice gloss. White pieces look like yellow plastic, with no chips, wear or blood |
| Board | 4 | better | mixed | Frame, studs and inlay are right. Squares are over-bright and maroon/yellow, with no visible grain or scuffs |
| Blood / wear | 3 | better (none before) | better (none before) | Spatter is fine. The pool reads as a rectangle. Nothing on pieces, hands, table grain or frame |
| Table | 4 | better | same | Worn wood is visible but orange and smooth. It lacks the reference's bleached, gouged slab |
| Props / clutter | 3 | better | same | Lamp, rusty mug and one paper. The lamp's underside is a flat beige disc. No book stack, papers pile or tray |
| Environment | 4 | better | same | Bars, beds, wheelchair and window are present but flat, clean, CG grey. No tiles or WARD sign |
| Lighting | 4 | better | worse on the board | The key now front-lights the pieces, but everything is monochrome amber. No cold fill reads, and the board clips |
| Camera / composition | 6 | much better | same | Lamp top-left, mug right, opponent centred. The opponent is too small and far, and the board dominates |
| UI / HUD | n/a (0 visible) | same | same | Not in the captures (finding 6) |
| Black-seat view | n/a | | | No screenshot (gap) |

## Top 8 fixes (visual payoff per effort)

1. **Grade and exposure (very low effort, hits every row).**
   - Cause: no grading in the post section of `build()`, a 2400 K key, and `Lamp_TableBounce`.
   - Post: `color_saturation` (0.72,0.72,0.72,1), `color_gain_shadows` (0.9,1.0,1.0,1),
     `color_gain_highlights` (1.05,1.0,0.92,1), `color_contrast` 1.15, toe 0.6.
   - Lights: `Lamp_Key` 2400→2800 K and 700→450 lm, `Lamp_TableBounce` 300→120 lm.
   - Target: crop saturation ≈150 and board luma ≈55, matching the reference.
2. **Board albedo (low).**
   - Cause: `MI_BoardSquares` has no tint, and the walnut colour in `ue5/tools/textures/board.py` is too red.
   - Code: add tint ≈(0.62,0.58,0.52), or rebake with walnut near sRGB (80,55,40) and maple near (165,135,95).
   - Bake a bleach-and-scuff layer and dark grime in the joints. The reference board is grey-brown and filthy.
3. **Blood that reads as blood (low-medium, owner's top ask).**
   - Edge fade: in `blood_decals()`, multiply opacity by a radial fade so no decal box edge shows.
   - Age: set `Darken` per instance to 0.5-0.7 so old blood goes brown-red.
   - Relief: reconnect the normal map at low strength (lerp to flat about 0.35), so the rim and cracks catch the lamp.
   - Placement: add 10-15 small decals in the square joints, on the frame studs, along the near table edge and in the
     table grain.
   - Pieces ignore decals (commit 5956705). Add a `BloodAmount` mask from the existing HandlingGrime channels to
     `MI_PiecesWhite`/`MI_PiecesBlack`, and give 3-4 pieces their own MI with blood at the base.
4. **Player hands: veins, dirt, nails, pose, cuff (medium, owner's top ask).**
   - Cause: the player body uses the stock MetaHuman skin (`spawn_opponent("player", ...)`, ~1384), and
     `ARM_TARGETS["player"]` (~861) places the left hand at the lamp.
   - Code alternative: a `hands.py` generator next to `blood.py` makes vein normals and cavity maps (ridge noise
     along a wrist-to-knuckle flow field) plus a dirt, nail-grime and blood mask. Blend it into a body-skin MI
     override for the player only.
   - Use an older, rougher MetaHuman skin preset (free) for the player.
   - Retarget the left hand onto the near frame (x≈-30, y≈-20).
   - Add a leather cuff and stained sleeve with `sleeve()` in props.py on `lowerarm_l/r`.
   - Fix the capture dithering first (finding 5), or the detail will not survive.
5. **Opponent pose: lean in, hands clasped at the chin (medium).**
   - Cause: the `clasp` target in `build_seated_pose` (`ARM_TARGETS`, ~860) solves to crossed arms on the chest,
     and there is no spine lean or head pitch.
   - Change: pitch spine_01-03 about 25° forward, put the elbows on the table (`elbow_z` near table height), move the
     hand target forward of the chin (+Y about 30), and pitch the head down about 15°. The face is then lit
     through the cage, as in the reference.
6. **Patient clothing (medium).**
   - Cause: `MI_PatientShirt` is a flat tint on the MetaHuman T-shirt.
   - Change: use a CC0 canvas or linen scan (Poly Haven or ambientCG fabric; check the slug through the API) with
     heavy grime and blood masks.
   - Add Blender props for straitjacket straps and buckles, and a leather wrist cuff (props.py, same pattern as
     `sleeve()`).
7. **Cage mask geometry and material (low-medium).**
   - Cause: `cage_mask()` in props.py builds flat strips, and `mi_rust` is applied uniformly.
   - Geometry: round-section wire (skin or bevel modifier, about 0.5 cm), a solid riveted brow band and chin strap.
   - Material: darken to iron (tint about 0.35) with metallic, polished edge wear and rust only in the cavities.
8. **Clutter and room dressing (medium).**
   - Lamp: the shade underside is a flat disc (`dome_lamp` bulb slot, M_TC_Bulb). Recess the bulb and give the shade
     an inner material.
   - Add a book stack (reuse the `ledger` prop ×3 with tints), a pile of papers with a real CC0 paper texture
     instead of the streaky cube, and a WARD B stencil decal.
   - Use Poly Haven CC0 tiles for the wainscot, and dirty the bed frames with the grime layer.

## Character design

- **Caged patient (the main shots)** against the reference:
  - Silhouette matches: cage helmet and pale shirt, centred behind the board.
  - It fails on posture (upright, arms crossed, looking up instead of hunched and staring), material (clean
    T-shirt instead of a soiled canvas jacket) and the cage itself (thin ribbons instead of heavy iron wire).
  - In the lamp light he reads as an orange figure, with no value separation from the room. A cold rim
    (`Corridor_Glow`/`Rim`) hardly registers once everything is graded amber.
  - Note: CHARACTERS.md §"prototype's cage mask" calls the cage the earlier design. The owner's reference is still
    the cage, so keep both until the owner decides.
- **The Annotator (`12-annotator.png`, older)** against CHARACTERS.md 2.2-2.4:
  - The silhouette rule fails. The plate renders as a flat, blown cream shield (no steel, no rolled-edge
    highlight, no rivets readable), with an oversized eye grid.
  - The coat reads olive or lime, not slate green (#3E4A43).
  - The tan oversleeves don't read as "two pale bars". The forearms show as bare orange skin.
  - Coif, gloves, the cut fingertip, ledger and pencil are not visible, and the top of the head is a black void.
  - Needs a fresh capture after fixes 1 and 7, before anything else is judged.

## Checked

All four new images plus 00, 22, 23 and 12. Pixel stats: luma, saturation and clipping against the reference crops.
md5 of the 22-27 files. Albedo samples of the board texture. build_scene.py: board, blood, post, lights, camera,
opponent and hands. TCBoard.cpp marker colours (none red-rectangular, so the red square is not a move marker).
TCGame.cpp HUD. CHARACTERS.md 2.2-2.4. HOSTILE_VISUAL_REVIEW.md (its grade fix in row 13 was never applied).
