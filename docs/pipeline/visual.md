# Visual judge report (stage 2)

Date: 2026-10-04. This is run 2. The "since run 1" column compares against run 1, which judged `27-main.png`,
`27-board-closeup.png`, `27-opponent-closeup.png` and `12-annotator.png`.
Judged images: `35-main.png` (caged patient, player view), `33-opponent-closeup.png`, `31-board-closeup.png`,
`38-annotator.png`, `38-annotator-closeup.png` and `38-caged.png`, all md5-distinct. They were checked against the
reference `/root/townchess-work/reference-northstar.png` (main panel, 0..1045 x 0..685).
`31-board-closeup` predates the cage, hand and strap commits but shows the grade, board and blood changes.

## Findings first (evidence)

1. **The grade fix was undone by a 2x exposure jump, so the frame is now flat and high-key.**
   - Mean frame luma per pass (1/4 scale): 27 = 45, 29 = 39, 31 = 39, **33 = 85, 35 = 85**. The reference is 27.
   - Saturation went 189 (27) → 139 (31) → **88 (35)**. The reference is 152, so we now overshoot into grey-pink.
   - Board crop luma is 126; the reference is 55, and run 1 measured 93. The room top band rose from 21 to 39.
   - No light or post line changed between 31 and 33. The commits in between are f081e11, c327541 and 44e16ed
     (cage MI, hand decals). The capture commands are the same (`shots28.ps1` and `shots32.ps1` on townchess-win).
     The cause is therefore outside the diffed lines. Bisect it before tuning anything else.
   - The result: there is no lamp pool and no falloff. The white beds, chair and cart read as bright clean CG props.
2. **The blood "rectangle" is not a texture problem.** In 35-main it is still a flat strip (sRGB 181,86,83) that
   covers rank 6 from e to g. Its top, bottom and left edges sit exactly on square edges.
   - `T_Blood_Pool_BaseColor.png` is a round blob (alpha bbox 209..1878 of 2048), and the radial fade in
     `blood_decals()` (~460) is in place. Even so, the edges follow the board grid.
   - So the clipping happens on the receiving side. Its position matches placement `("Pool", 6, 8, 11, 20)` (~1251).
   - The run-1 edge-fade fix could not have helped.
3. **The cage does not render as dark iron.** `MI_CageIron` has tint 0.07, but it reads cream-beige in
   33-opponent-closeup and copper-tan in 35-main.
   - Likely cause: `grime_color=(2.6, 1.3, 0.55)` (~1441) has values above 1. With GrimeThreshold 0.5 and Contrast
     3.0, about half of the surface is pushed to a bright tan.
   - The geometry is still flat rectangular strips (`cage_mask()` `band()` and `w.thickness = 0.0042`), not round
     wire. It is thicker now, but it looks like stamped sheet metal.
4. **The player's arm IK is far off target.** From `build-level.log` (townchess-win, 23:37):
   `player l ... error 174.0` and `player r ... error 561.4`, against `clasp l` error 5.8 and `clasp r` 38.8.
   - This is why the left hand is still a raised fist by the lamp post, and the right hand reaches over from the
     edge of the frame.
5. **The Annotator plate reads as copper or leather, not dark steel** (38-annotator-closeup):
   - The rivets are glowing salmon beads (`mi_copper` tint 0.95,0.5,0.32 on rusty_metal_02).
   - The eye grid is a checker of square holes. Next to the chessboard it reads as a sticker or a joke.
   - The worn-patch rectangle at lower right is a flat, unbevelled card.
   - The coat now reads slate grey-green, which is correct. The forearms are bare (LIM-011, as stated).
6. **Both opponents share one clasp pose.** The hand positions are identical in 35 and 38. For the caged patient the
   hands sit behind the black back rank and hide the queen and king. The torso is upright, with no forward lean.
7. **Black seat:** there is no screenshot. Per the lead, the board turns 180° for Black and the camera stays put.
   Note that `build()` still spawns a `PlayerEyeBlack` camera with tag `TC_Camera_Black` (~1595). If it is no longer
   used, it is dead weight.

## Scores (0-10 vs reference)

| Element | Run 1 | Run 2 | Since run 1 | Note |
|---|---|---|---|---|
| Opponent: face | 6 | 6 | same | Head now level and looking at the board; eyes and wrinkles read in the close-up. Flattened by exposure in the main view |
| Opponent: body/pose | 3 | 4 | better | Forearms on the table, as the reference has. No lean, hands mask the back rank, and the pose is copied onto the Annotator |
| Opponent: clothing | 2 | 4 | better | Grimy off-white shirt with stains, and a webbing strap with a brass ring. Still short T-shirt sleeves. The strap reads as a bib or yoke, not straitjacket buckles |
| Mask (cage) | 5 | 4 | worse | Thicker, but beige or tan instead of dark iron (finding 3). Flat strips, not wire |
| Player hands | 3 | 3 | same | Less orange, and faint vein relief at full res on the right hand. No dirt, nail grime or blood visible. Left hand is wrong (IK, finding 4). No sleeve |
| Pieces | 5 | 5 | same | Whites are ivory now, not yellow. Still clean plastic: no chips, wear or blood |
| Board | 4 | 4 | same | Less maroon, but brighter (luma 126 vs 55). Clean checker with no filth in the joints |
| Blood / wear | 3 | 3 | same | Spatter is good. The pool is still a rank-aligned strip (finding 2). Nothing on pieces or hands |
| Table | 4 | 4 | same | More neutral brown. Still smooth; no gouges or bleaching |
| Props / clutter | 3 | 3 | same | Brass bowl is hidden under the left fist and reads as a cork coaster. Shade underside is still a flat beige disc. The Annotator's ledger reads. The paper in 31 curls into the lens |
| Environment | 4 | 3 | worse | Exposure exposes the clean white beds, chair and cart. The reference room is near-black |
| Lighting | 4 | 3 | worse | High-key and flat. No lamp pool, no amber/teal split (finding 1) |
| Camera / composition | 6 | 6 | same | Same framing. Opponent small, board dominant |
| UI / HUD | n/a | n/a | same | Not in the captures |
| Black-seat view | n/a | n/a | n/a | No screenshot; board rotates 180° and camera stays (finding 7) |

## Top 8 fixes (visual payoff per effort)

1. **Get the low key back (low effort, affects every row).**
   - Bisect the 31 → 33 jump first: rebuild at fd4c24f and at 44e16ed with the same `shots32.ps1`.
   - Then aim for frame luma 27-35, board luma about 55 and saturation about 150:
     - Exposure: `TC_EV` 7.8 → about 9.5-10. The display luma ratio of 2.2 is about 2-2.5 stops.
     - Lights: sky 0.07 → 0.02, `BackWall_Wash` 4500 → 1500 lm, `Window_Cold` 2500 → 1000 lm,
       `Corridor_Glow` 2200 → 900 lm.
     - Grade: `color_saturation` 0.72 → 0.85.
   - Re-measure with this report's crops.
2. **Kill the blood strip (low).**
   - Hide the `Pool` decal at (6, 8) and recapture to confirm it is the source.
   - Then move pools off the playing surface onto the table and frame (keep the spatter on the board), or shrink
     the Pool to `sz` 6.
   - If it persists, check the board-squares receiver: `MI_BoardSquares` on the 9 x 9 grid plane from
     `chess_board()`.
3. **Make the cage iron (low).**
   - In `MI_CageIron` (~1440), set `grime_color` to about (0.22, 0.1, 0.04), GrimeThreshold 0.65 and roughness
     0.6-0.7 so the edges catch the lamp.
   - In `cage_mask()` (props.py ~62), give the wires a round section (bevel or a curve with depth of about
     0.25 cm) and keep the brow band flat with rivets.
4. **Fix the player's arms (medium).**
   - The IK errors are 174 and 561 (finding 4). Bring `ARM_TARGETS["player"]` into reach, or move the player body
     closer so both hands rest on the near frame (x≈-30, y≈±20).
   - Add a stained cuff or sleeve with `sleeve()` on `lowerarm_l/r`. This also hides the decal seam at the wrist.
5. **The Annotator's plate (low).**
   - Put the rivets and the patch on `mi_steel`, not `mi_copper`, and darken the steel tint to about 0.08 with
     edge wear.
   - Replace the square checker eye grid with a round drilled pattern (`annotator_mask` in props.py).
   - Bevel the patch card.
6. **Differentiate and lean the poses (medium).**
   - Caged patient: pitch spine_01-03 about 15-20° forward, and lower and spread the hands so the black king and
     queen show.
   - Annotator: give him his own target, with the right hand holding the pencil over the ledger (CHARACTERS.md 2.x)
     instead of the patient's clasp.
7. **Hand skin (medium).** The procedural vein decal is too faint at gameplay distance. The real fix is the owner's
   8K MetaHuman skin. Meanwhile, raise the dirt opacity in `M_TC_HandDirt`, add nail-bed and knuckle grime and a few
   dried-blood flecks on the fingertips, and darken the cuticles.
8. **Clutter reads (low).**
   - Move the bowl from (-8, -46) to where it is visible, for example (-14, -60) beside the lamp base, clear of the
     fist.
   - Give the lamp shade an inner material and a recessed bulb.
   - Keep the loose paper out of the board close-up camera.
   - Add the WARD B stencil and dirty the white bed frames with the grime layer (they are now the brightest thing
     in the room).

## Character design

- **Caged patient** against the reference:
  - Silhouette: cage head, pale shirt, forearms on the table. Closer than run 1.
  - The cage material is wrong: tan instead of dark iron, and flat strips.
  - The shirt is grimy now, which is good, but it is a short-sleeved T-shirt. The reference has long canvas sleeves
    with frayed cuffs and a leather wrist cuff. The single strap with a big ring reads as a bib.
  - Under the current exposure, he has no value separation from the bars behind him.
- **The Annotator** (`38-annotator*.png`) against CHARACTERS.md 2.2-2.4:
  - Better than run 1: the coat reads slate grey-green, the plate has rolled edges and a rivet seam, the coif dome
    shows, and his ledger is on the table.
  - It still fails "dark worked steel". The plate reads as copper or leather with pink rivets (finding 5).
  - The tan oversleeves are missing (LIM-011). The forearms are bare skin, so the "two pale bars" silhouette rule
    fails.
  - No gloves, cut fingertip or pencil in hand. His pose is the patient's, not a clerk's.

## Checked

- All six named screenshots (downscaled and full-res crops of hands, lamp, bowl and pool), plus 27/29/31/33 for the
  brightness trend.
- Pixel stats (luma, saturation, clipping) against the reference crops for frame, board, right hand and opponent.
- md5 of the 31-38 files.
- The pool decal texture's alpha.
- build_scene.py: post (~1618), lights (~1546), `blood_decals()`, Pool placement, `MI_CageIron`, `make_mi`,
  Annotator materials, `MI_BoardSquares`.
- props.py `chess_board()` and `cage_mask()`.
- `git diff fd4c24f 44e16ed`, which has no light or post change.
- On townchess-win: the capture scripts `shots28/32/36.ps1` and `build-level.log` (IK errors, BUILD OK, no skipped
  post settings).
