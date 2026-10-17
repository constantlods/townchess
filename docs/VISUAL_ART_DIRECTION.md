# TownChess visual art direction

Owner: visual director (`tc-visual-director`, roles 4 and 13). Status: Phase A (independent inspection of the
shared baseline). This file is the art-direction standard. Each graphics specialist checks their work against it,
and the visual judge scores against it. Numbers below come from the reference's main panel
(`docs/reference/concept-reference.jpg`, crop 0..1045 x 0..685, resized to 1920x1080 for comparison) and the baseline
(`docs/graphics/baseline/`, commit 7cb3a50). Measurement script: luma = 0.2126R + 0.7152G + 0.0722B on the JPEGs,
plus the V1/V2 metrics in `metrics.json`.

## 1. Visual goal

One sentence: **a single desk lamp in a dark asylum ward lights a filthy chessboard, your own scarred hands, and a
masked patient leaning in across the table. Everything the player needs for chess is in the light, and everything
else falls into a warm, smoky dark that you can still read.**

What "like the reference" means, in order of importance:
1. **Light tells the story.** One visible, motivated practical (the lamp) is the key. The board is in its pool, the
   hands and the opponent catch its falloff, and the room is lit only by spill, haze and a cold back source.
2. **The board is the stage. The opponent and your hands frame it.** Hands rest at the lower corners on the table
   rim, the opponent fills the upper third and leans over the far rank, and the board sits in the lower middle.
3. **Everything is used.** Wood is worn along the grain and at the edges, metal is dull and oxidised, cloth is
   stained, and skin carries dirt in its creases. Nothing is clean and nothing is decal-stamped.
4. **The chess stays readable.** Every square and every piece silhouette is readable from the default seat at every
   view height. The look never costs chess information (no DOF, fog, bloom, grain or prop on a square).

## 2. Reference categories

From the concept sheet (the only binding reference):

| Panel | What it fixes |
|---|---|
| MAIN GAMEPLAY VIEW | composition, light hierarchy, palette, set dressing density, hand pose |
| HAND CUSTOMIZATION | skin variants: bare, dirty, scarred, tattooed; gloves; sleeves; watch (wet sheen, crease dirt, visible nails) |
| PIECE INTERACTION | hand-to-piece scale, pinch grip, a warm rim on the knuckles from the lamp |
| CHESS PIECES (DETAIL) | worn, mottled ivory and ebony with chipped edges and a varnish sheen; not plastic |
| BOARD ENVIRONMENTS | variants (post-beta); the "Institutional Oak" thumbnail is the default room |
| FIND A GAME / PROMOTION / CHECKMATE | UI tone: thin serif-free caps, dark translucent panels, blood-red only for the result |

Named professional references, each used **only for the technique named** (not for content or style copying):
- *Practical-light cinematography* (Roger Deakins' practical-motivated keys, e.g. single desk-lamp interiors): one
  visible source keys the scene, and fill comes from bounce, not from invisible lights on each subject.
- *Outlast / Resident Evil 7 interiors*: material layering of grime in cavities, edge wear on painted metal, and
  dried blood that oxidises to brown at its edges.
- *Hellblade / MetaHuman skin shading*: subsurface, cavity-driven dirt, and roughness variation (oily knuckles, dry
  backs) for close-up hands.
- *Tournament-board photography* (Staunton sets under one lamp): piece silhouettes kept clear by a rim of light and a
  darker board frame.

## 3. Palette and tonal targets (measured)

| Measure (1920x1080 main view) | Reference | Baseline | Target |
|---|---|---|---|
| Mean luma (V1) | 26.6 | 25.6 | 24-30 |
| Median luma | 15.1 | 8.8 | 12-17 |
| Pixels below luma 8 (crushed) | 33.7 % | 48.7 % | 30-38 % |
| p95 (V1) | 97.1 | 102.4 | <= 100 |
| p99 | 158 | 169 | 140-165 |
| r/g, g/b (V1) | 1.44, 1.62 | 1.44, 1.64 | 1.38-1.50, 1.55-1.70 |
| Fine detail (V2) | 12.94 | 11.19 | >= 11.5 (beta), 12.5 (goal) |
| Brightest 0.5 % centroid (x, y as frame fractions) | 0.23, 0.39 (the lamp) | 0.36, 0.42 | on the lamp/board pool, x < 0.5 |
| Frame rows, top to bottom (6 bands) | 18 23 17 40 40 22 | 13 15 23 32 42 29 | the bottom band <= 25, the top two >= 16 |

Hue family: amber/umber (2400-3000 K) for everything the lamp reaches; desaturated olive-grey for the room; one cold
accent (6500-7500 K) behind the opponent (window/corridor), kept below luma 50 at p95. Blood is the only saturated red
and is never brighter than the wood around it.

## 4. Lighting hierarchy (rendering architect implements; values are targets in the main view)

1. **Key: the lamp** (warm 2600-2800 K). The shade's interior and bulb glow are **visible in frame** and are the
   brightest thing on screen (region p95 >= 200, not clipped over more than 0.2 % of the frame). Its pool centres on
   the board (board region mean 40-50).
2. **Falloff subjects:** the hands (region mean 22-35) and the opponent's face and hands (face mean 15-25, partly in
   shadow under the mask). They are never brighter than the board.
3. **Cold separation:** one back source (window/corridor) rims the opponent's shoulders and head. Room p95 <= 60.
4. **Room:** lit only by spill, bounce (Lumen) and volumetric haze. It is legible (median 12-17), not black.
5. **No subject-specific fill lights** that have no motivating source (`Hands_Key`, `Table_Right` today). Any fill must
   come from the lamp's direction.

## 5. Material principles per surface (materials / board-environment)

| Surface | Principle | Do not |
|---|---|---|
| Table | worn oak: wear follows the grain; the varnish is gone where hands rest (the near edge); grime gathers in the gaps; a few deep gouges | isotropic straight "straw" scratch lines across the grain; uniform tiling |
| Board | checker squares with a lacquer sheen and cracked varnish; a darker frame; dull oxidised brass corners | clean squares; mirror brass |
| Pieces | ivory: yellowed and mottled, darker in cavities, chipped at the crown; ebony: near-black with a warm specular; both with varnish roughness 0.3-0.5 | uniform noise grain; plastic white; equal roughness |
| Blood | dried: dark brown-red edges, thicker centre, drips and smears where it was touched | flat stamped splat decals of one shape |
| Skin (hands) | subsurface; dirt in creases, knuckles and nail beds (cavity-driven); visible nails; roughness varies | blotchy "leopard" spots; flat orange albedo |
| Cloth (sleeves, gowns, jacket) | woven canvas normal, grime at the cuffs, smooth shading normals | faceted/banded flat shading; olive tint under the warm key |
| Metal (cage, bed frames, lamp) | painted metal with chipped paint and rust; roughness >= 0.5 | bright clean chrome edges; hard blue-white bed grids |
| Paper/props | aged, foxed, with the ink readable at close range only | pure white edges |

## 6. Camera and composition standard (the visual director owns this)

Seat camera (`build_scene.py` camera block, `TC_Camera_White`; the Black seat reuses it, since the board turns):

| Parameter | Baseline | Standard |
|---|---|---|
| Eye position (board centre = 0, table top = `top`) | x -87, z top+42 | x -90, z top+34 (seated, leaning in) |
| Pitch | -19 deg | -14.5 deg |
| Focal length / sensor | 30 mm on 36 x 20.25 (HFOV 62 deg) | unchanged at view height 0 |
| Aperture / focus | f/2.8, focus 97 cm (with c = 1 px, the sharp zone is ~89-107 cm, so the near rank at 66 cm is outside it) | f/16 (or DOF off) with focus at 85 cm; no square or piece blurs by more than 1 px at 1080p |
| View-height slider (`ApplyView`) | +28 cm, +5 cm forward, -10 deg, 30 -> 24 mm | keep the range; at slider 1, every rule below must still hold |

Framing rules (as fractions of the frame height y and width x at 16:9; checked on every main-view screenshot):
- **Board:** the near edge at y 0.80-0.85, the far edge at y 0.53-0.58, the centre at y 0.62-0.67, and the near-edge
  width 0.44-0.50 of the frame. The board's left/right centre is at x 0.50 +/- 0.02.
- **Table margin:** at least 0.15 of the frame height of visible table between the board's near edge and the frame's
  bottom. The hands live there.
- **Hands:** both hands are fully in frame from the knuckles to the wrist, and the sleeve cuff shows at the lower
  corners (x 0.05-0.30 and 0.70-0.95). The hands rest on the table rim or the board frame and **never overlap a
  square or touch a piece** in the idle pose.
- **Opponent:** the head width is 0.13-0.17 of the frame width, the eyes/mask centre at y 0.12-0.25, and the crown
  may crop at the top. The head is above or just behind the far rank (he leans in, elbows on the table). The face
  never covers a square of the far rank.
- **The lamp:** in frame at the left (x 0.02-0.25, y 0.15-0.45), with the inside of the shade or the bulb visible.
- **HUD:** the safe area is x 0.02-0.98, and no HUD element overlaps the board or the opponent's face.
- **Black seat:** identical numbers. The black-seat screenshot is judged with the same rules (and the same HUD).
- **Close-ups and portraits** (menu thumbnails, HUD cards): 50-85 mm equivalent, f/2.8 allowed (no chess is shown).

Acceptance for camera changes: `capture.ps1` main and black-seat screenshots at view height 0 and 1, plus a short
measurement script that finds the board's corners (from the known square size 5.8 cm, projected through the camera
values) and reports the rule fractions above, together with V1/V2.

## 7. Asset priorities: replace vs improve

| Asset | Decision | Why |
|---|---|---|
| Lamp (shade + bulb + key light) | **replace** placement and shade material | it is the key light and is unlit and cropped today |
| Player hands' skin material | **replace** the grime layer (cavity-driven), improve the albedo/SSS | blotches read as a disease pattern, not dirt |
| Player sleeve + watch | **improve** (smooth normals, cloth texture; watch lugs and dial) | banding and a toy look in close-ups |
| Opponent (caged patient) | **improve**: the pose (lean in, hands clasped at the mouth), scalp grime/stubble, a long canvas jacket | silhouette right, presentation wrong |
| Table top | **improve**: replace the straight scratch decal with grain-aligned wear | the largest surface in frame |
| Pieces | **improve** the material only (wear, chips, cavity darkening) | the meshes are good Staunton silhouettes |
| Bed frames / wheelchair | **improve**: paint + rust material; dim them | the hard grids pull the eye |
| Room architecture | **add** the WARD B sign, barred window and pipes behind the opponent (board/environment) | the reference's depth cues |

## Phase A findings

Inspection of `base_main.jpg`, `base_black.jpg`, `base_hands.jpg`, `base_opponent.jpg` and `metrics.json` against the
reference main panel. Ranked by effect on the player (what they look at every second of a game first). Measurements
are on the 1920x1080 baseline frames (regions in pixels).

### 1. The lighting hierarchy is inverted: no visible key, hot hands, a crushed room

- **Evidence:**
  - The lamp, which is the reference's brightest element (lamp region p95 217; brightest-0.5 % centroid at 0.23, 0.39),
    is a dark, unlit shade cropped at the top edge in the baseline (shade region 360-640 x 60-200: mean 17, p95 62).
  - The player's left hand is 2.3x the reference's brightness (region mean 63 vs 27).
  - The bald head is the brightest thing above the board (p95 116 vs the reference's masked head at 81).
  - 48.7 % of the frame is below luma 8 (reference 33.7 %), and the median is 8.8 (reference 15.1).
  - The bottom band is the brightest (29.4 vs 22.4) and the top two bands are the darkest (13-15 vs 18-23).
  - The mean meets V1 only because the hands and board are over-lit while the room is crushed.
- **Likely cause:**
  - `build_scene.py` lighting block: the subject fills `Hands_Key` (200 lm) and `Table_Right` (80 lm) have no source.
  - `LAMP_BASE` (24, -56) puts the lamp beyond the board centre, so the camera sees only the outside of the shade.
  - The lamp has no emissive shade interior (the `Lamp_Bulb` point light lights the shade from outside).
  - `Lamp_Opponent` aims at head height and lights the bald dome.
- **Proposed fix:**
  - Move the lamp left and toward the player (about x -20, y -60) and lower it so the shade interior shows.
  - Give the shade interior and the bulb an emissive material, and make `Lamp_Key` the only key.
  - Cut `Hands_Key` by 60-70 % and remove `Table_Right`.
  - Re-aim `Lamp_Opponent` at the opponent's chest and hands so the face sits in partial shadow.
  - Lift the room with Lumen bounce and volumetric fog, not with fills.
  - Re-tune exposure to the median target.
- **Acceptance test:**
  - Main and black-seat screenshots.
  - Lamp region p95 >= 200, with clipping <= 0.2 % of the frame.
  - Brightest-0.5 % centroid x < 0.30.
  - Hands region mean 22-35; board mean 40-50; head p95 <= 90.
  - Median 12-17; pixels below luma 8 at 30-38 %.
  - V1 and V2 still met.
- **Effort:** M. **Owner:** rendering architect (lights, exposure); board/environment (lamp placement, shade
  material).

### 2. The composition: board pinned to the bottom edge, hands cropped, opponent too small and too far

- **Evidence:**
  - Board near edge at y ~0.97 (1050/1080) vs the reference's 0.77; far edge at 0.53 vs 0.47.
  - The board is steeper than the reference: vertical extent / near-edge width is 0.56 vs 0.45, which is an eye
    elevation of ~26 deg vs ~20.5 deg.
  - There is no table margin. Both hands are cut by the frame's bottom edge, the right hand rests on the frame next
    to the h-file rook, and the left wrist is cut at the watch.
  - The opponent's head is 0.10 of the frame width (reference 0.15). He sits behind the board rather than leaning
    over it, so the upper third is empty bed frame.
  - The near-edge width already matches (0.45 vs 0.47), so the lens is right and the height and pitch are wrong.
- **Likely cause:**
  - The camera block in `build_scene.py`: eye `(-87, 0, top + 42)`, `PITCH = -19`.
  - The f/2.8 focus at 97 cm also leaves the near rank soft.
  - The player's hand targets (`ARM_TARGETS`, player pose) sit at the board's near corners.
  - The opponent's seat distance and `POSES` give an upright, back-set posture.
- **Proposed fix:**
  - Eye `(-90, 0, top + 34)`, pitch -14.5 deg, f/16 focused at 85 cm, still 30 mm.
  - Move the hand targets onto the table rim about 8 cm nearer and outside the board frame.
  - Move the opponent's chair in about 15 cm, with a forward lean, elbows on the table and hands clasped at chin
    height (the reference pose).
  - Check `ApplyView` at slider 1 against section 6.
- **Acceptance test:**
  - Main and black-seat screenshots at view heights 0 and 1, measured against every section 6 fraction:
    - board near edge 0.80-0.85, far edge 0.53-0.58;
    - table margin >= 0.15;
    - both wrists in frame, with 0 hand pixels over a square (mask from a `-TCProbe` hand-only capture);
    - opponent head width 0.13-0.17.
  - Autotests drag/keys still pass, because picking depends on the camera.
- **Effort:** S (camera) + M (poses). **Owner:** visual director (camera values; `ApplyView` change proposed to the
  lead); hands/character (hand targets, opponent pose and seat).

### 3. The player's hands read as rubber with a skin disease

- **Evidence:**
  - `base_hands.jpg`: uniform orange albedo, with dirt as round, evenly spaced "leopard" blotches unrelated to the
    creases.
  - No nails are visible; the knuckles have no creases or redness, and there is no roughness variation.
  - The sleeve is flat-shaded, with visible stair-step banding at x 1700-1920.
  - The watch has a cartoon dial and a strap block that stands off the wrist.
  - In the main view, the hands are the largest near-field objects and (finding 1) the brightest, so every flaw reads.
- **Likely cause:**
  - `ue5/tools/textures/skin.py`: the grime is a noise-blob mask, not driven by cavity/AO.
  - The MetaHuman hand material is swapped for a flat-albedo instance.
  - props.py `player_sleeve` uses faceted normals (no smoothing groups) and no cloth normal map.
  - props.py `wristwatch()` is low-segment.
- **Proposed fix:**
  - Drive dirt from a cavity/curvature map (creases, knuckle folds, nail beds, under the nails).
  - Add albedo variation (red knuckles, pale palm edge, yellowed nails) and a subsurface profile.
  - Add a roughness map (oily knuckles, dry backs).
  - Smooth the sleeve normals and add a canvas weave normal with cuff grime.
  - Give the watch lugs, a printed dial and a strap that hugs the wrist.
  - Make the default look the reference panel's "dirty + sleeves + watch".
- **Acceptance test:**
  - A close-up (`-TCCamLoc/-TCCamTarget` at 25 cm from the left hand) and the main view.
  - Nails visible on at least 3 fingers in the close-up.
  - On the sleeve: no luminance step > 6 between adjacent 8-px bands.
  - Judge V4 >= 7.
- **Effort:** L. **Owner:** hands/character (mesh, props, pose); materials (skin and cloth shaders, `skin.py`).

### 4. The opponent is a lit bald egg in an olive tunic, not a menacing masked figure

- **Evidence:**
  - `base_main`/`base_opponent`: a smooth bald dome with a specular hot spot, the brightest skin above the board
    (head region mean 32 vs the reference's 21).
  - The face behind the cage is a clean, evenly lit photoscan.
  - The garment is a short, olive, flat-shaded tunic.
  - The pose is upright, with arms folded on the table edge.
  - The reference's figure is hunched forward, with hands clasped at the mouth, the face lost in the mask's shadow,
    a long grimy canvas jacket and a cold rim on the shoulders.
  - The close-up shows good skin detail and a good cage, so the assets are usable and the presentation is what fails.
- **Likely cause:**
  - The `spawn_opponent` MetaHuman head has no scalp hair, grime or sweat.
  - `Lamp_Opponent` aims at head height (`top + 45`).
  - `MI_PatientShirt`/`mi_jacket` tint reads olive under the 2400 K key.
  - `POSES` for the caged patient.
- **Proposed fix:**
  - Scalp grime, stubble and a sweat-roughness layer, plus a darker albedo.
  - Light as in finding 1, so the face is half in shadow and the head reads by its rim.
  - A long-sleeved canvas jacket in a desaturated grey-brown with blood and grime at the cuffs.
  - The leaning, hands-clasped pose (shared with finding 2).
- **Acceptance test:**
  - Main view and a portrait capture.
  - Head region p95 <= 90 and mean 15-25.
  - Jacket hue: r/g >= 1.25 (not olive) in the lamp light.
  - Judge rows face, body/pose and clothing >= 6.
- **Effort:** M-L. **Owner:** hands/character (pose, clothing, head); materials (skin/cloth); rendering architect
  (aim of `Lamp_Opponent`).

### 5. The surfaces read as CG decals: straw scratches, stamped blood, plastic pieces, neon bed grids

- **Evidence:**
  - Fine detail is 11.19 vs the reference's 12.94; V2 is not met at baseline.
  - The table is covered by straight, uniformly thin, randomly oriented "straw" lines that cross the grain (the
    largest surface in frame, left and right of the board).
  - The blood on the squares is flat, same-shape splats.
  - The ivory pieces are evenly white with a uniform noise grain (`base_hands.jpg` pieces), with no cavity darkening
    or chips.
  - The bed springs and frames are a hard blue-white grid (background region p95 109 vs the reference's 46) that
    pulls the eye away from the board.
- **Likely cause:**
  - The table's knife-scar layer (stains.py decals / the `wood_table_worn` scalars) is generated as straight
    segments at random angles.
  - The splat decal set has one shape and no oxidised rim.
  - The piece materials have uniform roughness and grain with no AO/cavity mask.
  - The bed frames have a low-roughness, light paint.
- **Proposed fix:**
  - Regenerate the scars as grain-aligned wear, plus a few deep gouges and a hand-polish zone at the near edge.
  - Blood decals with drips, smears and a dark oxidised edge.
  - Piece materials with cavity darkening, yellowed ivory variation, chip masks and varnish roughness 0.3-0.5.
  - Bed frames in chipped paint and rust at roughness >= 0.6, darkened.
- **Acceptance test:**
  - Main view: V2 >= 11.8 (goal 12.5), and background region p95 <= 60.
  - A piece close-up (`-TCCamLoc` at 15 cm) shows cavity darkening and at least one chip per piece type.
  - Judge rows table, pieces, blood/wear and environment >= 6.
- **Effort:** M. **Owner:** materials (piece/table/metal shaders, stains.py); board/environment (decal placement, bed
  props).

### Noted for the lead (outside my files)

- `base_black.jpg` shows **no clocks** under the player cards (`base_main` shows 04:48/04:58). Either the capture
  was untimed or the HUD drops the clocks for the Black seat (TCGame.cpp `DrawGame`); check which. It is not a look
  issue, but the judge will see it.
- `ApplyView` re-focuses on the board actor's centre. With f/16 (section 6) this is harmless. If DOF stays at f/2.8,
  the near rank goes soft at every view height.
