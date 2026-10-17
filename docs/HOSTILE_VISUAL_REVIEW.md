# Hostile visual review: build vs north star

Inputs: `/root/townchess-work/reference-northstar.png` (target: the MAIN GAMEPLAY VIEW panel; secondary: PIECE INTERACTION and CHESS PIECES (DETAIL)) against `docs/screenshots/visual-loop/00-baseline.png` (commit 90da748, 1920x1080, cinematic, RTX 4070 Ti SUPER).
Code references are to `ue5/TownChessBench/Scripts/build_scene.py` (BS:line), `ue5/TownChess/Source/TownChess/Private/TCBoard.cpp` (TCB:line) and `ue5/tools/fetch_polyhaven.py` (FP).

## First 5 seconds

1. **A robot is playing me.** The opponent is the UE5 template mannequin: a glossy orange-and-grey faceplate, a white plastic forearm and a chrome claw on the board. That says "engine sample", not horror. Its head is cut off by the top of the frame, and its arms hang straight instead of leaning on the table. The reference's whole hook is the caged, hunched patient whose clasped hands sit at your eye line.
2. **My hands are chrome motorbike gloves.** The XR mannequin hands lie flat and splayed, well outside the board, with no wrists, sleeves or arms attached. They read as two props on the table, not as me.
3. **I cannot tell White from Black.** Both armies render the same matte mid-brown-grey. The player's own pieces are backlit and come out as dark silhouettes.
4. **This is a showroom board on a polished cherry table.** The marble board and varnished orange tabletop are clean and saturated. The reference is grey-brown, bleached, scuffed wood with blood in the grain.
5. **The room is a brown smear.** A flat, blurry back wall, a wardrobe-like box at the left, and a wheelchair and a white desk at the right edge. There is no window, no bars, no bed frames, no WARD sign and no depth layering. The brightest things in frame are a blank white binder and a white desk corner, both at the frame edges.
6. **The camera looks straight down at the board.** The near board edge sits on the bottom of the frame, there is no table foreground for the hands, and the lamp (the reference's main compositional anchor) is out of frame.

## Ranked gap table

| # | Element | Reference | Build | Sev | Cause in code | Fix |
|---|---|---|---|---|---|---|
| 1 | Opponent | Hunched patient in a stained canvas straitjacket-style shirt. Elbows on the table, fingers laced in front of the mask, leather wrist cuff. Fills the top-centre of the frame. | Template Manny: plastic and glossy, upright, arms down, head cropped, right hand clipping toward h8. | blocker | BS:751-770 spawns `SKM_Manny_Simple` with a hand-built `A_TC_Seated` pose (BS:460 `build_seated_pose`). There is no lean, no clasp and no clothing. | MetaHuman (see Sourcing) with an outfit. As a stopgap: add a "lean + clasp" pose in `build_seated_pose` (spine_01-03 pitched forward about 25°, upper arms forward, hands meeting about 35 cm above the table at x≈55), and swap Manny's material for a dark, matte, rough MI so it at least reads as a silhouette. |
| 2 | Mask | Rusty iron cage helmet (fencing or catcher's-mask grid) over the head, with dark eye sockets visible through the wire. | None. Manny's smooth faceplate. | blocker | Nothing in BS spawns a mask. | Attach a cage mask static mesh to the `head` socket (see Sourcing: CC-BY museum scan or a Blender build). Material: `rusty_metal_02` (already imported at BS:657, never assigned). |
| 3 | Hands | Two bare, dirty, veiny hands resting on the near board frame. Sleeves and a leather cuff enter from the bottom corners. Shot at about 30mm, so they look large and near. | Chrome XR gloves, flat, 35 cm apart on the varnish, no forearms. | blocker | BS:772-785: `SKM_MannyXR_{left,right}` at `(-22, ±35, top+6)`, yaw -90, using the default chrome material. There is no arm mesh. | MetaHuman arms, or a Fab FPS arms rig, with skin material and sleeves. Rest pose: wrists at x≈-30, y≈±20, fingers curled onto the board frame, forearms continuing out of frame at the bottom corners. Use UE First Person Rendering (separate FOV for the arms) so the 30mm world camera does not stretch them. |
| 4 | Pieces | Glossy lacquered boxwood and ebony, clearly two colours. Chipped edges, blood on some, a sharp specular glint per piece, soft rim light from the lamp. | Both armies matte brown-grey with sandy speckle. White pieces backlit to near black. | blocker | (a) The key light is behind the pieces as seen from the camera: `Lamp_Key` at `(24,-34)` aims at `(4,0,top)` (BS:788), so the player sees the shadow side of every white piece. (b) `MI_PiecesBlack` uses grime colour `(0.8,0.7,0.6)` (light dust on ebony) and `MicroRough 0.3` (BS:690), which pushes black toward brown and matte. (c) The grime/micro layers sample UV × `GrimeTiling 3`, which shows up as speckle on tiny UV islands. | Move the key to the player's side (see Lighting). Black: grime colour about `(0.15,0.1,0.07)`, RoughnessScale about 0.35, MicroRough ≤0.08. White: RoughnessScale about 0.4, tint slightly ivory. Drive grime by world-aligned or curvature/AO masks rather than piece UVs. Check the Poly Haven white diffuse is actually being bound: compare `MI_PiecesWhite` vs `MI_PiecesBlack` base colour in the editor. |
| 5 | Board | Worn wooden board with a raised brass-studded frame. Ivory and brown squares, scuffed, with blood smears. | Clean grey marble, light squares clipping to white, thin flat frame. | major | The Poly Haven `chess_set` board mesh is marble (BS:692 `MI_ChessBoard` = its own maps plus faint grime). TCB:50-57 just places the mesh. | Build our own board: a frame box with `wood_table_worn` or `dark_wood`, inset squares with a 2-tone worn-wood texture, and a decal pass (blood, cup rings). Or source one from Fab (paid). Lower base-colour albedo of the light squares to ≤0.55. |
| 6 | Table | Thick slab, grey-brown, bleached, deeply scratched, with splinters and dark blood in the cracks. Occupies the whole lower third. | Saturated varnished cherry with a crisp bevel. Almost none of it is visible. | major | BS:674-676 uses `wooden_table_02`'s own diffuse, which is orange and varnished. The `wood_table_worn` MI is created at BS:656 and then thrown away. | Assign `MI_wood_table_worn` (or `old_planks_02` / `weathered_planks`) to the top. Desaturate it to about 0.35, roughness about 0.8, then add blood/scratch decals. The camera change (below) brings 15-20% of frame height of table into view. |
| 7 | Lighting | One warm dome-lamp key from the left at board height, hard falloff. Cold teal window fill from the back-left. Near-black olive ambient. Pieces rim-lit and glinting. | Key from behind the board, a pool that clips the paper and board, flat dull fill, no motivated cold source. | blocker | BS:788-797: key position/aim, `Fluorescent_Fill` 2200 lm 6200K from the ceiling, `Rim` 120 lm with nothing to motivate it, SkyLight 0.02. | See Lighting breakdown. |
| 8 | Camera/lens | Eye about 42 cm above the table, about 62 cm from the near board edge, pitch about -20°, about 30mm (36mm-eq). Table foreground visible, opponent's head touching the top edge. | 50 cm high, about 41 cm from the near edge, -27°, 24mm. The board fills the frame bottom to centre and the opponent's head is cut off. | major | BS:809-818 and the black-seat mirror at BS:828, the capture at BS:839. | See Camera match. |
| 9 | Composition | Lamp mass at upper-left, mug and books at right, opponent centred. Bed frames and window layered behind at three depths. Frame corners darkened. | Board centred and dominant, and nothing frames it. The lamp is out of frame. The brightest objects (binder, white desk) are pinned to the frame edges. | major | The lamp is at `(30,-52)` (BS:727), outside a frame whose top is pitched down. The binder is at BS:734 and the desk at BS:741, both white/clean. | Lamp at about `(-10,-62)` so the dome shade sits in the upper-left third. Mug (`metal_jug` stand-in) at about `(10,48)`, books/papers at about `(-5,58)`. Darken or remove the white desk, and age the binder with `MI` tint 0.5. |
| 10 | Environment | Asylum ward: white tile wainscot gone grey-green, peeling plaster, barred window with cold light, iron bed frames, WARD B stencil. | Low-res brown plaster box. Cabinet, wheelchair, pipes. No silhouettes behind the opponent. | major | BS:652-670 builds the walls from `box()` cubes with `painted_plaster_wall`/`cracked_concrete_wall`. The props list in FP has no bed, window or tiles. | Wainscot `long_white_tiles` or `dirty_tiles` up to 120 cm, plaster `damaged_plaster` or `peeling_painted_wall` above. `old_bed_frame` x2 behind the opponent, a window opening with bars (procedural cylinders plus `rusty_metal_grid`) back-left, and a stencil decal "WARD B" on the back wall. |
| 11 | Materials | Everything is dirty in the same visual language: edge wear, dark crevices, specular breakup. | One generic UV-tiled fbm grime layer for everything (BS:294 `grime_png`), so it reads as noise rather than wear. | major | BS:99-220: the grime mask is UV-space and never uses AO, curvature or world position. | Add an AO-driven cavity darkening term (ARM.R or a baked AO), a world-aligned blend for walls and floor, and real decals (DBuffer) for blood, rings and stains. Replace the procedural mask with CC0 grunge textures (Poly Haven `dirty_concrete`, `rust_coarse_01`) as masks. |
| 12 | Atmosphere | Thick haze lifts the background to dark olive and separates three depth planes. Light shafts from the window. | Thin fog. The background is just dark, with no shafts. | minor | BS:798-806: `fog_density 0.02`, `volumetric_fog_extinction_scale 1.0`, and there is no window light to scatter. | Density 0.035, extinction 2.5, albedo dark olive `(150,150,120)`, start distance 120 cm. A window RectLight with volumetric scattering 3. |
| 13 | Post/grade | Low key (mean luma about 27/255), crushed blacks, warm highlights, teal-olive shadows, heavy vignette, visible grain. | Mean luma about 38/255. Clipped whites on the board and binder, neutral shadows, vignette too weak. | minor | BS:848-865: EV 8.5, vignette 0.45, no colour grading. | EV +0.5 (`TC_EV=9.0`) once the key is moved, vignette 0.65, grain 0.2. Shadows gain `(0.92,1.0,0.98)`, highlights gain `(1.05,1.0,0.9)`, global saturation 0.85, toe 0.6. |

## Camera match

Method: I measured the reference main view (1045x686, 3:2) and fitted a pinhole camera to the board's outer frame, assuming a frame about 50 cm wide. The near edge is 1090/2000 px wide at y=0.76, and the far edge is 680 px wide at y=0.48. Least-squares fit: f ≈ 1680 px on a 2000 px width.

| | Reference (fit) | Ours (BS:809-818) |
|---|---|---|
| Eye above table | about 39-42 cm | 50 cm |
| Horizontal eye → near board edge | about 61-66 cm | about 41 cm (eye x=-66, near edge x≈-25) |
| Pitch | about -21° | -27° |
| Focal (36mm-wide equivalent) | about 30 mm (HFOV ≈ 61°) | 24 mm (HFOV ≈ 74°) |
| Near board edge position in frame | 76% down | about 100% (on the frame edge) |
| Board near-edge width / frame width | 0.55 | 0.56 |

On a 16:9 filmback the same horizontal FOV gives less vertical FOV, so we cannot match the reference's near-edge position and its head-room at the same time. Numbers to try, in order:

1. **Eye `(-87, 0, top+42)`, pitch -20, 30 mm, focus 97 cm, f/2.8.** The near edge lands at about 0.87 of frame height, the frame top at about 1° below horizontal, and the opponent's mask touches the top edge if it leans forward (pose fix #1). This is the closest match.
2. Eye `(-83, 0, top+44)`, pitch -19, 28 mm, focus 95 cm. Slightly wider; use it if the hands need more room.
3. If the upright opponent must stay: same eye, pitch -18, 27 mm.

Apply the same values to `PlayerEyeBlack` (BS:828) and `ShotCapture` (BS:839). These are three copies of the same numbers, so move them into one constant. Move the hands with the camera so they stay at the bottom 25% of frame.

## Lighting breakdown of the reference, mapped to UE

| Role | Reference | UE implementation |
|---|---|---|
| Key | Practical desk lamp with a dark metal dome shade, upper-left, head about 40-45 cm above the table and level with the near half of the board. About 2400 K, deep amber. It rakes across the board from frame-left: the left half is hot, the right side falls to near black. The opponent's hands and mask catch it from the left. | `SpotLight` inside the shade at about `(-12,-58,top+42)`, aimed at `(10,-5,top)`. 2400 K, 700 lm, outer cone 65°, inner 30°, source radius 2.5, volumetric 1.2. Put it on the player's side of the board centre so the pieces are lit three-quarter from the front. Use an IES profile, or a light function, for the shade cut-off. Swap `desk_lamp_arm_01` for a dome-shade lamp (the shade is the visible practical). Give the shade underside an emissive bulb at about 30 nits. |
| Shade bounce | A warm glow on the brass base and the table under the lamp. | A small `PointLight` under the shade, 2400 K, 60 lm, radius 60, no shadows (this replaces the current `Lamp_Bulb`). |
| Fill | A cold, weak teal-cyan from the barred window back-left and the far ward. About 7000-8000 K, about 3-4 stops under the key. It outlines the opponent's shoulders and the bed frames. | `RectLight` 60x90 in the window opening at about `(cx+L/2-5,-150,180)`, facing -X. 7500 K, 400 lm, volumetric 3 (gives shafts). Reuse `Rim` as an opponent back-rim: 6500 K, 80 lm, behind the opponent's left shoulder at `(150,-60,top+70)`. |
| Ambient | Near-black olive-brown. Shadow areas lifted only by haze. | SkyLight about 0.01 with a dark olive lower hemisphere, or none, letting Lumen GI do the work. Grade shadows toward teal-olive. |
| Practicals | Lamp (on), window (cold), perhaps a dead overhead fixture. | Keep `mounted_fluorescent_lights` but dim the `Fluorescent_Fill` RectLight to about 150 lm at 5600 K (or off). The current 2200 lm flattens the room. An optional slow flicker via a light function adds unease. |
| Haze | Moderate, mostly beyond 1.5 m. It separates the opponent, the bed frames and the wall into planes. | ExponentialHeightFog density 0.035, falloff 0.002, start 120 cm, volumetric fog on, extinction 2.5, albedo `(150,150,120)`. A Local Fog Volume behind the opponent for extra separation. |
| Exposure | Low key: highlights only on the shade, the left board squares and specular glints. Crushed blacks, warm-sepia/teal split. | Manual exposure. Retune `TC_EV` after the key move, aiming for mean luma about 25-30/255 and no clipping on the board. Bloom 0.3 (lamp glow), vignette 0.65, grain 0.2, chromatic aberration 0.1. |

## Sourcing

### Poly Haven (CC0: free, no attribution, commercial use OK). Every slug below was checked against `api.polyhaven.com/assets` on 2026-10-03.

Add these to `MODELS`/`TEXTURES` in `ue5/tools/fetch_polyhaven.py`. URL pattern: `https://polyhaven.com/a/<slug>`.

| Need | Slugs (type) | Note |
|---|---|---|
| Wall tiles | `long_white_tiles`, `dirty_tiles`, `interior_tiles`, `grey_tiles` (tex) | Use for the wainscot. Desaturate `long_white_tiles` and darken the grout. |
| Damaged plaster | `damaged_plaster`, `peeling_painted_wall`, `decrepit_wallpaper`, `rough_plaster_broken` (tex) | Upper wall. |
| Floor | `old_linoleum_flooring_01`, `damaged_concrete_floor` (tex) | |
| Rust | `rusty_metal_02` (already fetched, unused), `rust_coarse_01`, `rusty_metal_grid`, `metal_grate_rusty`, `rusty_painted_metal` (tex) | `rusty_metal_grid` also works as an alpha-masked window grille or a cage-mask stand-in material. |
| Table wood | `wood_table_worn` (already fetched, unused), `old_planks_02`, `weathered_planks`, `dark_wood` (tex) | |
| Mug/cup | No mug exists. Closest: `metal_jug`, `pot_enamel_01` (models) | The reference tin mug: model one in Blender (a cylinder plus a handle, `rusty_metal_02`), or buy one. |
| Tray | No institutional tray (`seeding_tray_01` is a plant tray, wrong). | Model it: a bevelled box with `rusty_painted_metal`. |
| Papers | None as models. | Planes with decals (procedural or CC0 paper photos). Keep `binder_notebook` but darken it. |
| Books | `book_encyclopedia_set_01` (in use), `decorative_book_set_01`, `wooden_bookshelf_worn` (models) | |
| Bed frame | `old_bed_frame` (model) | Two behind the opponent. The silhouettes are the point. |
| Cabinets | `vintage_cabinet_01`, `painted_wooden_cabinet`, `painted_wooden_cabinet_02`, `drawer_cabinet` (in use), `worn_metal_rack` (models) | |
| Dome-shade lamp | `hanging_industrial_lamp` (dome shade; mount the head on a cylinder stem plus a round base for a desk lamp), `industrial_wall_lamp`, `caged_hanging_light`, `industrial_caged_sconce` (models) | There is no dome desk lamp on Poly Haven. Kitbash the `hanging_industrial_lamp` shade onto a stem, or model it in Blender (a lathe profile, about 30 min). |
| Barred window | No window model (`rollershutter_window_*` are shutters, wrong). | Build it procedurally: a wall cut plus a frame from boxes, vertical bars as cylinders with `rusty_metal_02`, and frosted glass. |
| Mask base | `old_gas_mask` (model) | Can sit under the cage for a nastier face. |

### MetaHuman (opponent and first-person hands)

- **Cost and licence:** free. MetaHumans are covered by the standard Unreal Engine EULA plus the MetaHuman content terms. Free under $1M USD annual revenue; above that, the normal UE terms apply. Use in a UE game is allowed, as is selling the game. Restriction: MetaHumans must not be used to train or test AI/ML models. Sources: https://www.metahuman.com/license, https://www.unrealengine.com/license, https://www.cgchannel.com/2025/06/you-can-now-sell-metahumans-or-use-them-in-unity-or-godot/
- **In-editor:** yes. Since 5.6, MetaHuman Creator is a plugin inside Unreal Editor (the cloud-streamed web Creator is retired). Sculpting and editing run locally. **Auto-rigging and texture synthesis call Epic's cloud services and need the editor signed in to an Epic account.** That is an owner action. https://dev.epicgames.com/documentation/metahuman/getting-started-with-metahuman-creator-in-unreal-engine
- **Python:** yes, from UE 5.8. Requires the MetaHuman Character plugin and Python scripting. Calls: `set_face_model_coefficients`, `set_body_constraints`, `try_add_item_from_wardrobe_item`, `request_auto_rigging(blocking=True)`, `request_texture_sources(blocking=True)`, `build_meta_human(...)` with the UE Cine / UE Optimized pipelines. https://dev.epicgames.com/documentation/metahuman/metahuman-creator-python-scripting-in-unreal-engine?lang=en-US
- **Linux (VM 131):** the 5.8 release notes confirm Linux only for MetaHuman Animator (facial). Creator on Linux is not stated. **Untested risk.** Fallback: author the character once on the Windows box and commit the built assets. https://dev.epicgames.com/documentation/metahuman/metahuman-5-8-release-notes-in-unreal-engine?lang=en-US
- **Clothing:** slot-based wardrobe in Creator. Custom garments are authored in a DCC and combined into an **Outfit Asset**, which fits to the body and supports resizing. Stock wardrobe items are generic modern clothes. A straitjacket-style canvas shirt means a custom Outfit (Marvelous Designer or Blender cloth, then Outfit Asset) or a Fab purchase. Stains come from a material layer on the outfit.
- **Hands:** build a second MetaHuman (or reuse the opponent's body), hide the head and torso, and render the arms through UE's First Person Rendering so they keep their own FOV and do not clip. The skin variations in the reference panel (Dirty, Scarred, Tattooed) map to material-instance swaps on the body skin.

### Cage mask

| Option | Licence/cost | Verdict |
|---|---|---|
| "Fencing Mask" (19th-century iron wire mesh, museum scan, 60.9k tris) by urheilumuseo, Sketchfab https://sketchfab.com/3d-models/fencing-mask-85ecb07deca64fabae7ee92a0f9460b6 | CC BY 4.0, free. Credits required. | **Best quick win.** The shape is already close to the reference. Retexture with `rusty_metal_02`, add two iron straps and a buckle in Blender. |
| Other Sketchfab fencing masks (e.g. https://sketchfab.com/3d-models/fencing-mask-756c744300a540f7b50fc579ed6d4ebc) | Check each one's licence on its page. Use only CC0 or CC BY. | Alternates. |
| Procedural in Blender | Free, ours. | Recommended long term: a UV sphere segment, wireframe modifier (0.25 cm) on a quad grid with 1.2 cm cells, solidified straps, then bake normals. About 1-2 h, fully scriptable (`bpy`), and it stays in-repo. |
| Fab "cage mask" or "horror mask" listings | Paid (most), Fab Standard licence. Fab blocks automated fetch, so prices are not verified. | Only if the above fail. **Needs owner approval.** |

### Fab / Quixel for hands, pieces and tables (flag: paid unless stated)

Fab returned 403 to scripted fetches, so **every Fab price below is unverified; treat it as paid until the owner checks.** The Fab Standard licence allows use in a commercial game.

- **Hands:** "FPS Arms 01 (Rigged)", UE 4.27-5.8, Epic skeleton, https://www.fab.com/listings/78949782-1f94-43a5-bd64-fc120716a711. "FPS Arms 03a", https://www.fab.com/listings/92a3b982-8718-46ba-83a6-d7b74d9935cf. "Animated First Person Arms Pack" (Ironbelly), https://www.fab.com/listings/ba65ca6c-1484-4144-b5bb-d7c37516e49b. All paid, probably. The free route is MetaHuman arms.
- **Chess pieces:** "Chess set" (PBR, LODs), https://www.fab.com/listings/378a7c1d-24e0-4ad6-a4a6-9abf492928ed. "Chess board and pieces", https://www.fab.com/listings/54ed2190-3db4-4179-a41b-139744b73b11. Photogrammetry "Unreal Engine Chess Minifigures" on ArtStation (paid), https://www.artstation.com/marketplace/p/XK9ql/unreal-engine-chess-minifigures. The current Poly Haven `chess_set` pieces are fine geometrically; the problem is shading and lighting, so fix that before buying anything.
- **Worn tables/wood:** Megascans moved to Fab. Since 2025 only a free starter subset of about 1,500 assets remains free; the rest is paid. **If the owner claimed the full Megascans library in late 2024, it is already owned.** Check Fab → My Library (sign-in needed). FAQ: https://support.fab.com/s/article/Fab-Transition-FAQs?language=en_US. Do **not** use third-party re-uploads of Megascans scans on Sketchfab: the licence is unclear.
- Never rip assets from commercial games, including the reference's obvious Outlast influence.

## What procedural work cannot close

The opponent's face, hands and cloth (MetaHuman with an Outfit), and possibly a dome lamp and a tin mug (a short Blender session). Everything else in the gap table can be done in `build_scene.py`: lighting, camera, table/board materials, tiles, bed frames, window bars, haze and grade.
