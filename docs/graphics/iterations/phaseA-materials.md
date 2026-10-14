# Phase A: materials and shading audit

Role 6 (materials). Date 2026-10-13, base `a82c55d` (`feature/photorealistic-renderer`). Phase A is inspection only: no
scene, material or texture change was made. The other specialists' Phase A outputs were not read.

Inputs: `docs/graphics/baseline/base_main.jpg`, `base_hands.jpg`, `base_opponent.jpg`, `metrics.json`, the reference
`docs/reference/concept-reference.jpg` (main panel 0..1045 x 0..685, plus the HAND CUSTOMIZATION / PIECE INTERACTION /
CHESS PIECES panels), and the material code: `build_master_material`, `make_mi`, `surface_material`, `model_material`,
`board_squares_material`, `blood_decals`, `hand_decal_materials`, `paper_material`, `player_skins` and every instance in
`build()` (`ue5/TownChessBench/Scripts/build_scene.py`), plus `ue5/tools/textures/{skin,board,stains,blood,hands,forms,watch}.py`.

## G-buffer evidence (one capture cycle, lock owner `materials`, 20:36-20:39, released)

`capture.ps1 -Preset epic -Source basecolor|normal` at the baseline cameras (`baseline.ps1` parameters), files on the
build PC `C:\TownChess\shots\`: `mat_main_bc`, `mat_main_n`, `mat_hands_bc`, `mat_hands_n`, `mat_opp_bc` (.png; not
committed, this phase commits only this file). Base-colour readings (sRGB 10/50/90th percentile in a box):

| Surface | Base colour | What it proves |
|---|---|---|
| player hand, back + forearm (`mat_hands_bc`) | median (134, 93, 76); 115 dark blobs (BC < 0.8 x 41-px median, 20-2000 px), 2.7 % of the hand | the leopard spots are in the texture (skin.py), not shading |
| patient jacket sleeves (`mat_main_bc`) | median **(127, 129, 0)**: saturated yellow-green, blue 0 | the "olive sleeves" are a base-colour error; the code's `MI_PatientJacket` tint (0.42, 0.34, 0.23) on rough_linen cannot give this, so the runtime material differs from the code's intent (to trace in the editor) |
| cage mask (`mat_opp_bc`) | flat black (median 29, 28, 27 at the bars) | the bronze/tan cage in the final image is entirely specular from the lamp: material has no colour, no variation |
| black pieces | median (37, 32, 28) | near-black albedo confirmed |
| white pieces | median (174, 163, 142), uniform | no cavity darkening in grooves |
| bed frames (`old_bed_frame`, FBX importer material) | 90th percentile **(255, 255, 255)** | imported Poly Haven props without `model_material` keep the importer's guess; a white of albedo ~1.0 is not physical (max ~0.8-0.9 for fresh white paint); also the wheelchair and cart top |
| table | scratch decals visible as pale straight lines in base colour | confirms they are painted, not relief |
| lamp enamel | blotchy rust-orange / teal | the rusty_metal_02 scan dominates the "dark green enamel" tint |

Normal buffer (`mat_main_n`, `mat_hands_n`): the patient's torso, the player sleeve, every untextured prop and the
pieces are smooth (no folds, weave or wear); the board squares and the table scan carry the only surface relief in the
lower half of the frame besides the hands' veins.

## Measurements

Per-region fine detail (mean |Laplacian| of luminance, both images scaled to 1045 px wide; "median3" is the same after
a 3 x 3 median filter, i.e. with pixel-scale grain removed). Regions are boxes over the same content in each image,
not the same pixels. Script: a one-off numpy/scipy measurement (method as V2, plus the median3 column).

| Region | Reference detail | Ours detail | Reference median3 | Ours median3 | Reading |
|---|---|---|---|---|---|
| whole frame (ours includes the HUD text) | 12.89 | 12.50 | 7.18 | 6.96 | 44 % of both is pixel-scale grain |
| board + pieces | **27.90** | **19.81** | 15.33 | 11.44 | largest structural deficit (-29 %) |
| near table band | 6.03 | 11.57 | 4.41 | 5.63 | ours *exceeds* the reference: the scratch decals |
| right table side | 8.29 | 7.35 | 4.62 | 3.44 | flat book covers, paper, cart |
| opponent torso | 13.79 | 11.30 | 7.30 | 5.81 | flat cloth, no folds or weave |
| left hand | 17.39 | 13.29 | 9.69 | 6.81 | skin: blotches instead of creases |
| right hand | 5.83 | 6.82 | 4.20 | 3.43 | (ours mostly in shadow) |

(`metrics.json` gives 11.19 for base_main with its own crop; my whole-frame number includes the HUD text and is not
comparable to it, only the region ratios are.)

Piece maps (Poly Haven `chess_set`, read from the build PC's copy): white diffuse mean sRGB 0.75, black diffuse mean
sRGB 0.18; both roughness maps median 0.29 (16-bit). With the instance values (`MI_PiecesWhite` rough x0.72,
`MI_PiecesBlack` rough x0.55, black tint 0.11) the black pieces end at a linear albedo of about **0.003** and a
roughness of about **0.16**; the white pieces at about 0.21 roughness.

## System-level findings in the material code

1. **Grime is UV-space value noise, never cavity.** `M_TC_PBR` builds its wear from one 512 px tiling fBm mask
   (`grime_png`: R blotches, G streaks, B micro) sampled at `UV0 x GrimeTiling`. Nothing in the master reads AO,
   curvature, cavity or world position, so "dirt in the crevices" (comment on `MI_PiecesWhite`) does not happen: the
   blotches land at random on tops, flats and edges alike, the same pattern on every object.
2. **No microsurface on untextured instances.** About 25 of the ~45 instances pass `{"BaseColor": None}`: flat tint,
   flat normal, AO 1 and a constant roughness of `0.627 x RoughnessScale` (default ARM G = 160/255). Books, pages,
   pill bottle, cart, webbing, patient shirt, player shirt and sleeve, Annotator coat, coif, cage, buckle and watch are
   all a single colour with a single gloss. That is the "plastic/CG" look.
3. **Unused detail maps.** `blood.py` already generates a tileable `grime/T_HandlingGrime_Mask.png` (smudges,
   scratches, fingerprints, lacquer chips) and `T_HandlingGrime_Normal.png` (scratch/chip/fingerprint relief). No
   material imports them. There is no detail-normal input in the master at all.
4. **`model_material` loses AO.** Poly Haven model sets have no AO map, and the instance keeps the default ARM (R = 1),
   so the pieces get no baked occlusion in their crowns, collars and the knight's mane. (The docstring's "optional
   metal" map is not handled either; the chess set has none, so harmless today.)
5. **Metal flag bug left over.** `MI_CartSteel` has `metal=1.0` without `METAL_ARM`, so ARM.B = 0 and it renders as
   grey dielectric (the bug pass 60 fixed for the brass). It is also the clipboard's steel clip.
6. **One shading model.** Everything is DefaultLit: no Cloth (sheen/fuzz) for fabric, no Subsurface for wax/skin-like
   props, no clear coat for lacquered wood or the piece finish.
7. **Outfit materials replace MetaHuman's.** `spawn_opponent` sets `outfit_mi` (`MI_PatientShirt`, untextured) on every
   material slot of the MetaHuman clothing meshes, so the outfit's own normal map (folds, seams, weave) is thrown away.
   The player's body wears the same `MI_PatientShirt`.
8. **Decals without relief.** `M_TC_Blood` samples its `Normal` parameter but never connects it (comment: the relief
   shaded black); the stain/scratch decals ship a flat normal. Blood and knife scars are therefore paint only.
9. **Grime colour above 1 as "dust"** (`MI_PiecesBlack` 2.2, `MI_LampEnamel` 1.8, `MI_Buckle` 1.6): legal as a lighten
   but on a 0.003 albedo it changes nothing visible.

## Per surface

| Surface | What reads wrong (baseline image) | Why (code / values) |
|---|---|---|
| **Skin, player (default `dirty`)** | `base_hands`: dark round spots 3-10 mm all over the back of the hand and forearm ("leopard"), dirt sits on the flats not in creases; forearm one flat orange-tan wrist to elbow; dirt is as glossy as the skin | `skin.py variant()`: `blot` (fBm 0.5/cm) x `fine` (fBm 3/cm) through hard smoothsteps (0.4 and 0.35 wide) make isolated blobs; only 45 % of the dirt weight is `crease`; dirt colour is a multiply by (0.42, 0.33, 0.24), so every blob is a 58 % darker hole; `spots` (smooth 0.42..0.6 of fBm 1.6/cm) add a second set of round darker spots on hand and forearm; no low-frequency subdermal variation is added to the flat MetaHuman base colour (only a 0.78 desaturation); grime is baked into base colour only, the MetaHuman skin roughness is untouched |
| Skin, patient (also `dirty`) | `base_main` torso crop: hands read leathery/mottled rather than grimy | same texture set; at gameplay distance the blotches merge into mottling |
| **Cloth** (patient shirt, player shirt/sleeve, Annotator coat, webbing) | patient torso: one smooth olive surface, no fold, seam or weave; straitjacket webbing indistinguishable from the shirt; player sleeve flat-shaded with visible facet bands (`base_hands`) | findings 2 and 7: untextured instances with a flat normal replace the MetaHuman outfit material; roughness constant 0.56; DefaultLit, no sheen; `MI_PatientJacket` is the only cloth with the linen scan. The sleeve's banding is mesh faceting (hands/character's prop) that no normal map hides |
| **White pieces** | smooth satin cream/bone, uniform from crown to base, no dirt in the grooves, bright speculars | roughness ~0.21 (scan median 0.29 x 0.72), tint (0.52, 0.45, 0.34) keeps them the warmest object; grime blotches by UV noise (finding 1), no AO (finding 4) |
| **Black pieces** | glossy black plastic: all form comes from mirror streaks, no wood colour or edge wear (reference: dark brown worn ebony with lighter edges) | linear albedo ~0.003 (diffuse 0.18 sRGB x tint 0.11), roughness ~0.16; real ebony/black lacquer is ~0.02-0.04 albedo and satin when handled |
| **Board squares** | light squares orange-cream with soft brown blotches, dark squares near-black and flat; blood reads as bright flat red paint; detail 19.8 vs reference 27.9 | `board.py`: light tint (0.93, 0.80, 0.62) then instance tint (0.42, 0.40, 0.36); grime is low-frequency (blot at R/64, gaussian R/160) and mottling at 96/24/6 px; dark squares get only a +0.05 dust term; the reference squares are grey-beige and mottled at high frequency on both colours; blood decal flat (finding 8) |
| Board frame / brass | frame OK; brass corner studs small dots of uniform dull colour | `MI_BoardBrass` constant roughness 0.75, no edge wear |
| **Table** | the near table and right side covered in pale straight lines like scattered straws, uniform in length and brightness | `stains.py scratch()`: 260 straight 1-4 px strokes with a "fresh wood" rim (linear 0.40, 0.28, 0.16) at alpha 0.95, flat normal, one texture repeated 12 times (pass 62/64 placements); the table's own scan (`wood_table_worn` x3.5, NormalStrength 2.2) is fine underneath. Near-band detail is now 2x the reference's, the wrong kind |
| **Metal / brass** (bowl, lamp, cart, watch, buckles) | bowl reads as smooth gold-brown; cart steel grey and plasticky; watch steel bright and clean | constant roughness (bowl 0.36, watch 0.22), no edge/cavity variation; cart is a dielectric (finding 5) |
| **Cage mask** | `base_opponent`: a smooth tan/bronze tube with a uniform sheen, no forging marks, rust or wear | `MI_CageIron` dielectric, albedo 0.012 (below any real iron), constant roughness 0.43 outside the sparse grime (threshold 0.7, contrast 3): the warm lamp's specular is the only colour; no edge wear (no curvature/AO map for the Blender prop) |
| Paper (forms, books, clipboard) | forms acceptable at distance; book covers single flat colours, pages flat | forms have a baked texture (`forms.py`) but no normal/curl; book covers and pages untextured (finding 2); clipboard sheet adds 0.12 emissive (a cheat that brightens it out of the light) |
| Imported props (beds, wheelchair) | bed frames glare white in the background of `base_main` | FBX importer materials, never replaced: base colour 255 white in the G-buffer (see above) |
| Wall / floor / cell bars | mostly too dark to judge in the main view; tiles and plaster scans tile visibly at 2-3x on the wainscot in `base_main` (upper right) | scans on box UVs with tiling 2-3 and one grime layer; acceptable for now, below the hero surfaces in priority |

## The five largest failures, ranked

| # | Failure | Fix | Acceptance test | Effort |
|---|---|---|---|---|
| 1 | **Leopard-spot skin grime and a flat forearm** (the hands are the reference's subject and the owner's main complaint) | `skin.py`: dirt driven by cavity: `crease`, nail rim, knuckle folds, finger sides and webbing between fingers (mesh AO from the dumped mesh); replace the `blot x fine` blobs by a broad low-contrast film (fBm ~0.15/cm, smoothstep width >= 0.6, max darkening 20-25 %, shifted grey-brown instead of a 0.42 multiply); cut `spots` to a few faint freckles; add subdermal low-frequency variation (redder knuckles/wrist, paler underside, faint blue over the veins) to the forearm; write a dirt mask so dirt can be made rougher (needs a roughness input on the MetaHuman skin instance, to check in the editor) | `-TCSource=basecolor` at the base_hands camera: dark blobs (BC < 0.8 x 41-px median, 20-2000 px) on the hand fall from 115 to <= 35; >= 60 % of the darkening lies inside the crease/nail mask; final-colour close-up judged "grime in creases, no spots"; judge hands row >= 7 | M (one evening: skin.py run, 8K normal reimport with `TC_SKIN_REIMPORT=1`, two captures) |
| 2 | **Flat cloth** (patient shirt, jacket body, player shirt/sleeve, coat, webbing) | stop overwriting the MetaHuman outfit material: make the outfit instance a child of the outfit's own material and only change its colour parameters (keeps folds/seams), or give `make_mi` a cloth preset: a woven-fabric scan (rough_linen is on disk, or a CC0 canvas/cotton) normal + ARM at tiling 10-14, roughness 0.85-0.95, grime from a cavity/AO term; a `M_TC_Cloth` master variant on the Cloth shading model with a faint fuzz colour | normal G-buffer at base_main: torso box shows fold/weave structure (normal-luminance std up >= 2x the baseline capture); torso median3 detail >= 7.0 (ref 7.30, ours 5.81); jacket-sleeve base colour no longer yellow-green (BC blue channel > 0.5 x green; today 0 vs 129) | M |
| 3 | **Pieces: black plastic and clean satin ivory** | black: base albedo to ~0.03-0.04 linear (tint ~1.0-1.3 on the 0.18 sRGB scan, slightly warm brown), roughness 0.35-0.5 with handled shine only on the crown tops; white: aged bone/boxwood, roughness 0.35-0.45; add a `Cavity` texture input to the master and bake one per piece set from the scan's normal map (the curvature method skin.py already uses) or from Blender AO: dirt and AO in grooves, lighter worn edges on convex rims (black pieces show brown wood there) | in base_main the black pieces' specular dominance falls: p99/p50 luminance ratio inside the black-piece masks drops >= 30 %; BC capture: white-piece groove/top luminance ratio <= 0.7; judge pieces row >= 6 next to the CHESS PIECES panel | M |
| 4 | **Board squares and table scratches** (wrong kind of detail: board too smooth, table too stripy) | `board.py`: light squares toward grey-beige (lower red/green tint), high-frequency mottling and pitting on both square colours, dark squares lifted to albedo ~0.06-0.08 with visible grain and pale scuffs, chipped lacquer at square corners; blood decals connect a softened normal and darken to dried brown-red; `stains.py scratch()`: fewer, curved, varied scars, dark grooves with rim alpha <= 0.35, a real normal map, three seeds instead of one texture | board region detail >= 25 (ref 27.9, ours 19.8) and median3 >= 13.5; near-table band detail <= 8 (ref 6.0, ours 11.6) with no straight pale lines visible at 1080p; whole-frame V1 still inside its bounds; V2 still >= 11.5 | M |
| 5 | **No microsurface on untextured instances** (books, pages, bottle, cart, coat, cage, buckle, bowl, watch) and the cart's dielectric "steel" | master: a detail-normal input (`T_HandlingGrime_Normal`, already generated) at its own tiling and strength, and roughness variation from `T_HandlingGrime_Mask` (smudges, fingerprints, chips) so a flat instance still has a varied gloss; per instance: cart takes `METAL_ARM`; cage becomes metallic dark iron (base ~0.2-0.3 grey, roughness 0.6-0.8 varied, rust in cavities) once a cavity/edge mask exists for the prop (vertex colour or bake: request to hands/character, who owns the wearable props) | roughness G-buffer is not exported by capture.py: add `SCS_...` for roughness is a lead request; until then the final-colour test: highlight area on the bowl/cart/cage in base_main and base_opponent breaks into >= 3 separate lobes instead of one smooth band; cage pixels' red/blue ratio in base_opponent down >= 25 % (bronze -> iron) | S-M |

Order of work: 1 and 3 touch only skin.py / piece instances and are independent of the other specialists; 2 needs
the MetaHuman outfit parameter names (editor check); 4 should follow the rendering architect's exposure work so the
board tint is judged under the final light; 5's master change rebuilds every instance and should go in one build.

## Fine detail (V2), honestly

- 44 % of the reference's Laplacian energy is pixel-scale grain (median3 filter: 12.89 -> 7.18). The reference is a
  noisy painted image; a V2 gain can be bought with film grain, sharpening or noise in a base colour. That would raise
  the number and make the picture worse; none of the fixes above use it, and each fix is measured with the median3
  column next to the raw one so grain cannot pass as detail.
- Where real detail is missing: the board (-29 %, the largest gap and the largest pixel area), the opponent torso
  (cloth folds and weave), the hands (creases, knuckle folds, nail detail). Where we already have more than the
  reference: the near table band, made of the straw-like scratch decals; fix 4 lowers that band on purpose. Expect the
  whole-frame number to move little at first (board up, near table down); the per-region table above is the honest
  target.
- Real sources of fine detail available to us: scan normal maps at their native density (the 8K piece maps are already
  used; table/board scans are 4K), a detail normal at a second scale, cavity-driven dirt (high-frequency where geometry
  is), and decals with relief. Not available without new assets: forearm hair (needs a groom, hands/character) and
  finer cloth geometry.

## Requests to other owners (not done here)

- Lead: `capture.py` exports basecolor/normal only; a roughness/metallic G-buffer source (SCS has none; a buffer
  visualisation material or `r.BufferVisualizationTarget`) would make roughness fixes measurable.
- Hands/character: a cavity/edge mask (vertex colour or baked AO) on `cage_mask` and `player_sleeve`; smoother
  normals or more segments on the sleeve (the banding is geometry).
- Board/environment: the scratch decal placements in `build()` are theirs; fix 4 changes the texture, they may want
  fewer placements.
