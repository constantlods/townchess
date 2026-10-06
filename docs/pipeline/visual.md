# Visual judge report (stage 2)

Date: 2026-10-06. Run 4 (BETA focus), base `d466ca1`. Reference: `docs/reference/concept-reference.jpg`, main panel
(top-left, 0..1045 x 0..685) plus the HAND CUSTOMIZATION, PIECE INTERACTION and CHESS PIECES panels.
Judged images (newest passes only):
- main view: `58-main.png` (current default), `54-hud-portraits.png` (Annotator), `51-clutter.png`;
- menu: `52-menu-hands.png`;
- hands: `53-hands-veins.png`, `53-hand-before-after.png`, `57-skin-variants.png` (bare / dirty / scarred / patient's
  hands), `57-forearm-closeup.png`, `52-watch.png`;
- board: `55-board-before-after.png`.

No Black-seat screenshot exists in passes 51-59, so that row is not scored. Added during this run: `59-skins-in-game.png`
(2cab890, dirty above / scarred below, switched from the menu). The dirty skin now shows real grime smudges on the
back of the hand. The scar is a single small pink line, and the bare knee fills the lower left again (finding 1).

## Findings first (evidence)

1. **The player's bare legs show in every downward view.** In `53-hands-veins`, `57-skin-variants` (all three skin
   panels) and `52-watch`, two smooth, unclothed knees/thighs fill the lower half of the frame under the table edge.
   They read as a naked mannequin. Cause: the player body is `spawn_opponent("player", ..., outfit_mi=mi_gown_early)`
   (build_scene.py ~1726), which only attaches what is in the MetaHuman `Clothing` folder (the shirt). Nothing covers
   or hides the legs. This is a V5 failure in the close-ups.
2. **The main view shows one hand, not two.** In `58-main`, the player's left hand is cropped at the bottom-left
   (knuckles only, wrist off-frame). The right hand is a sliver of fingertip at the bottom-right corner (x~1460,
   y~1060). The reference's main panel has two full hands with wrists and sleeves resting at the board's near edge.
   The veins of pass 53 are only readable in close-ups.
3. **The hand detail is half there.**
   - Veins: present, but embossed like worms of even thickness and too regular (`57-forearm-closeup`).
   - Dirt: the default skin is `bare` (build_scene.py ~1731, `TC_PLAYER_SKIN` default). "Dirty" is a faint mottle
     in the 2x2 grid.
   - Nails: not visible in any committed image (the fingertips point away from the camera or are cropped).
   - Scarred: indistinguishable from bare at this exposure (`57-skin-variants`, bottom-left).
4. **The watch is a placeholder-grade model** (`52-watch`). The case is faceted (low segment count) with a blank cream
   dial, no hands and no indices. The strap does not meet the case: a visible gap, and the strap stands off the
   wrist. The menu says "Sleeves + Watch" in `52-menu-hands`, but that same frame shows a bare hand with no sleeve.
   No image shows the sleeves in the main view.
5. **The board's brass corner plates read as pale paper tiles** (`58-main`, `52-menu-hands`: four cream squares with
   specks at the frame corners). This is `MI_BoardBrass` (build_scene.py ~1374, metal 1, tint 0.72/0.52/0.26,
   rough 0.38) mirroring the lamp. It does not read as brass.
6. **The opponent's clothing is still a short-sleeved tan tee**, with a ring buckle centred on the chest that reads
   as a logo (`58-main`, `57-skin-variants` bottom-right). The reference has a long-sleeved, filthy canvas jacket
   with cuffs. The patient's dirty hands (pass 57) are a clear win: the speckled grime reads at gameplay distance.
7. **The Annotator's plate** (`54-hud-portraits`) is a flat tan shield. Its "checker eye opening" (props.py
   `annotator_mask`, drilled squares) reads as a texture-test checker at gameplay distance. The plate also lights
   flat and bright: the brightest object above the board.
8. **What is better:** exposure and grade match (V1 pass 58). The board squares now carry grime and pits (pass 55,
   right half). The pieces sit darker and read as ivory/ebony. The HUD has portraits on the opponent card. Clutter
   (pill bottle with blood, papers, books, tin mug, tape) fills the table like the reference.

## Scores (0-10 vs the reference)

| Element | Run 3 | Run 4 | Change | Note |
|---|---|---|---|---|
| Opponent: face | 6 | 5 | worse | Bald, orange, mostly hidden behind the cage at gameplay distance. The reference reads as a wet, gaunt face |
| Opponent: body/pose | 4 | 6 | better | Folded arms with dirty hands in front of the pieces. Stiff and upright, but credible |
| Opponent: clothing | 4 | 4 | same | Short-sleeved tee with a chest ring (finding 6) |
| Mask | 4 | 5 | better | The cage reads dark iron now. The Annotator plate is flat, with a checker eye (finding 7) |
| Player hands | 3 | 4 | better | Veins exist (close-ups). Main view: one cropped hand. No nails, light dirt, bare legs (findings 1-3) |
| Pieces | 5 | 6 | better | Darker, grimier ivory. Good Staunton silhouettes. Still no chips or blood on pieces |
| Board | 5 | 6 | better | Grime, pits and grain on the squares (pass 55). The corner plates read as paper (finding 5) |
| Blood / wear | 4 | 5 | better | Splashes on 3 squares, a stained pill bottle. Nothing on the table edge, hands or pieces |
| Table | 4 | 4 | same | Wide flat brown areas left and right of the board. No gouges or drips. V2 detail is 11.4 against 11.5 |
| Props / clutter | 3 | 5 | better | Lamp, bowl, pills, papers, books, mug, tape. The lamp shade is a blotchy procedural orange, and the bowl reads wooden, not brass |
| Environment | 4 | 5 | better | Beds, bars, wheelchair, linoleum. The bed springs are a hard blue-white grid. No WARD B sign or window |
| Lighting | 5 | 6 | better | The grade matches V1. The lamp lights its own shade from outside, and the bulb is a flat white disc. No hot pool on the board |
| Camera / composition | 6 | 6 | same | The board dominates the lower half, and the hands are cropped out. The reference frames hands + board + opponent |
| UI / HUD | 5 | 6 | better | Cards with a portrait, clean sans, quiet action list. The human card has a "P" monogram, and there are no row icons |
| Black-seat view | n/a | n/a | n/a | No screenshot |
| **Average (14 scored rows)** | 4.4 | **5.2** | +0.8 | **BETA V3 not met**: 8 of 14 rows are below 6, and the average is below 7 |

**V4 (hands: veins, dirt, nails; >= 7): 5/10, not met.** Veins are present but exaggerated. Dirt reads in the
dirty skin (`59-skins-in-game`), but `bare` is the default and the main view shows no dirt. Nails have never been
visible in an image. "Scarred" is one small mark.

**V5 (placeholder/broken assets): not met.** Every item seen:
1. Bare player knees/thighs below the table in all downward views (`53-hands-veins`, `57-skin-variants`, `52-watch`).
2. The watch: faceted case, blank dial, strap gap / stand-off (`52-watch`).
3. The board corner "brass" plates render as cream paper squares (`58-main`, `52-menu-hands`).
4. "Sleeves + Watch" is selected, yet the frame shows a bare hand (`52-menu-hands`). The sleeves are unproven in any image.
5. A captured pawn clips into / sits under the player's fingers (`53-hand-before-after` left, `51-clutter` pawns at the hand).
6. Jagged white paper edge at the right border (`58-main` x 1830-1920, y 800-900), and an untextured pale tilted slab
   at the right (`54-hud-portraits` / `58-main` x 1650-1920, y 540-720).
7. The Annotator's checker eye reads as a texture-test checker (`54-hud-portraits`).
8. HUD monogram "P" tile instead of a portrait for the human player (`58-main`; TCGame.cpp ~940).
9. The lamp bulb is a flat white disc under the shade (`58-main`, x 480-560, y 180-230).
No world-grid (default checker) materials were found in any judged image.

## Top 8 fixes (visual payoff per effort, with the cause in code)

1. **Hide or clothe the player's legs.** Cause: build_scene.py `spawn_opponent("player")` (~1726) attaches only the
   MetaHuman shirt. Fix: in `ATCGameMode` (the place where the head is hidden for `TC_PlayerBody`), call
   `HideBoneByName("thigh_l"/"thigh_r", PBO_None)` on the player body; or attach a dark institutional trouser
   (MetaHuman free clothing, or a props.py cloth tube on the thighs, like `player_sleeve`).
2. **Two hands in the main view.** Cause: the player pose targets "hands resting on the board's near corners"
   (build_scene.py ~925, `build_seated_pose(..., pose_name="player")`), and the camera crops them. Move both hand
   targets ~8-10 cm towards the camera and ~6 cm inward, wrist slightly pronated so the nails show, until both wrists
   are in frame. Make "sleeves" the default look so the forearm edge matches the reference.
3. **Default skin "dirty", and calmer veins.** Cause: `TC_PLAYER_SKIN` default `bare` (build_scene.py ~1731) and the
   default look in `ATCGameMode::ApplyPlayerLook`. In `ue5/tools/textures/skin.py`: halve the vein normal strength,
   vary the width (taper, branch), add knuckle creases and nail-bed grime, and darken the scar albedo so "scarred"
   reads.
4. **The patient's jacket.** Cause: `MI_PatientShirt` (build_scene.py ~1685) on the MetaHuman short-sleeve outfit.
   Fix: put the Annotator's `coat_sleeve` and `oversleeve` props (props.py) on the patient in a canvas tint, with
   grime and blood (grime_color), so the long sleeves and cuffs match. Darken the `restraint_straps` buckle
   (`MI_Buckle` ~1711) to rough iron so it stops reading as a chest logo.
5. **The board corner plates.** Cause: `MI_BoardBrass` (build_scene.py ~1374). Tint ~(0.30, 0.20, 0.08), rough 0.6,
   grime threshold 0.3: aged dull brass. Check in a close-up that the slot name match `"brass" in n` catches the
   `Corner` boxes from props.py `chess_board` (~652).
6. **The watch.** Cause: props.py `wristwatch()` (~887) and its attachment (build_scene.py ~1774). Raise the segments
   (case 48, crystal bevel), add lugs that join case and strap, and add a dial texture (indices + hands, from code).
   Measure the strap against the MetaHuman wrist (the case stands ~1 cm proud).
7. **The lamp reads cheap.** Cause: `dome_lamp` materials (build_scene.py ~1389-1400). Swap the blotchy shade for
   Poly Haven painted/rusty metal (CC0) with a darker exterior and an emissive, warm interior. Hide the bare bulb disc
   (emissive bulb mesh, or a diffuser), and raise the key spot's lumens with a tighter cone, so the board gets the
   reference's hot pool and the room falls off.
8. **Table detail (also V2 11.4 -> 11.5).** Cause: `surface_material(master, "wood_table_worn", tiling=2.5, ...)`
   (build_scene.py ~1298). Use a heavier-worn CC0 plank set (ambientCG Planks/WoodFloor with scratches). Add
   gouge/knife-scar and blood-drip decals along the near edge (`ue5/tools/textures/stains.py`), and a darker
   vignette at the left and right of the board.
Also worth doing (lower payoff): row icons and a human portrait in the HUD (TCGame.cpp `DrawGame` ~938); a thinner
checker eye (or a slot) in props.py `annotator_mask`; trim the jagged record-sheet edge at the right.

## Character design
- **Caged patient vs the reference:** the silhouette is right (hunched, caged head, folded arms). The materials are
  wrong: a clean, orange-lit bald head and a short-sleeved tee against the reference's grimy long canvas. The cage
  now reads iron (better). The hands are the best part (dirty, grimy speckles).
- **The Annotator (CHARACTERS.md: clerk, riveted two-leaf plate, coat):** the plate reads, but as a flat, bright tan
  shield, brighter than anything else above the board. The coat is near-black and does not separate from the
  room. The ledger and pencil are not visible in `54-hud-portraits`. Readability in the lamp light: the plate yes,
  the body no.
