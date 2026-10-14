# Asset pipeline (board, pieces, table, props, room)

Owner: board/environment specialist (roles 8, 10, 12; `.claude/agents/tc-board-environment.md`). Phase A, 2026-10-13:
inspection only, no scene change. Baseline: `docs/graphics/baseline/` (commit 7cb3a50, `metrics.json`). Reference:
`docs/reference/concept-reference.jpg`. Close-ups for this audit: see "Evidence" at the end.

How assets reach the level today: `ue5/tools/fetch_polyhaven.py` / `fetch_ambientcg.py` download CC0 sources to
`C:\TownChess\assets\polyhaven` (not committed); `ue5/tools/blender/props.py` writes our own OBJ props to
`ue5/assets/props`; `ue5/tools/textures/*.py` bake our own textures to `ue5/assets/textures`;
`ue5/TownChessBench/Scripts/build_scene.py` (run by `ue5/TownChess/Scripts/build_level.py` with `TC_GAMEPLAY=1`)
imports everything into `/Game/TownChess` and builds `L_Table`. The pieces are spawned by the C++ `ATCBoard`
(lead-owned) from the meshes `build_scene.py` hands it.

## 1. Hero asset inventory

State: **OK** = imported as intended; **DEGRADED** = imported but visibly below its source; **BROKEN** = missing
texture/mesh or not in the level; **UNUSED** = fetched, never placed. "Imported" checked in the build PC's
`Content/TownChess/Models/*` and `Content/TownChess/Textures/*` (dir listing 2026-10-13).

### Board and pieces

| Asset | Source | Licence | Resolution | State |
|---|---|---|---|---|
| Pieces (32, 6 meshes used per colour) | Poly Haven `chess_set` | CC0 | FBX imported is `chess_set_2k.fbx` (`import_model` takes the first `.fbx` in the folder; `_2k` sorts before `_8k`); maps are 8K because `model_material` keeps the last match in sorted order | DEGRADED: plastic sheen and a fine speckle over the white pieces (`base_main` 580-760 x 840-1000; close-up below); no chips, no blood. The unused 2K maps and the FBX's own materials are imported too |
| Board mesh | our own `props.py chess_board()` (55.3 cm, 5.8 cm squares, 4.45 cm frame, 2 mm lip, brass studs) | own | 8x8 grid UV 0..1 | DEGRADED: frame thin and low next to the reference's heavy riveted frame; studs too small to read from the seat |
| Board squares | own `textures/board.py` from Poly Haven `white_maple_veneer` + `dark_wood` | CC0 sources | 4096 baked (512 px per square, 88 px/cm) from **4K** sources (`fetch(..., res="4k")`); the 8K hero fetch in `fetch_polyhaven.py` is not used by `board.py` | DEGRADED: judge "squares look printed and flat"; MI tint 0.42/0.40/0.36 flattens the scan |
| Board frame | Poly Haven `wood_cabinet_worn_long` | CC0 | 4K | OK (tiling 2) |
| Original Poly Haven board | `chess_set` board | CC0 | 8K | UNUSED in gameplay (replaced by our board) |

### Table and table-top clutter

| Asset | Source | Licence | Resolution | State |
|---|---|---|---|---|
| Table mesh | Poly Haven `wooden_table_02` | CC0 | 2K FBX imported (4K on disk, same first-`.fbx` rule) | DEGRADED: its own scanned maps are replaced by `wood_table_worn` tiled 3.5x with tint 0.7/0.6/0.5 |
| Table top surface | Poly Haven `wood_table_worn` | CC0 | 4K | DEGRADED: reads "flat brown" (judge Table 4/10, the lowest row) |
| Knife scars / scuffs | own `textures/stains.py` "Scratch" decal | own | 1024 | BROKEN as relief: colour-only straight hairlines; `T_Stain_*_Normal.png` are perfectly flat (pixel std 0.0 in all three channels, measured) |
| Mug rings, handled grime | own `stains.py` "Ring", "Dirt" | own | 1024 | OK at gameplay distance (normal flat, roughness varies) |
| Blood decals (spatter, pool, smear, drips) | own `textures/blood.py` | own | 2048 with real normal/roughness | OK; judge wants more on pieces and the table edge |
| Dome lamp | own `props.py desk_lamp()` + emissive bulb/inner face | own | no texture (enamel MI from `rusty_metal_02`) | DEGRADED: reads dead (judge finding 3); the shade's open side faces away from the seat |
| Brass bowl, tin mug, book stack, pill bottle, loose record sheets, clipboard, med cart | own `props.py` (+ `forms.py` sheet) | own | smart-project UVs, untextured MIs except sheets | OK (bowl, mug, books, pills); clipboard DEGRADED (placement, pale slab) |
| Medical tape | Poly Haven `medical_tape` | CC0 | 2K | BROKEN: no texture imported (`Models/medical_tape` holds only the mesh and the FBX material); white blob in `base_main` 1490-1560 x 670-730 |
| Cigarette pack | Poly Haven `cigarette_pack` | CC0 | 2K | BROKEN: imports as a skeletal mesh (`_PhysicsAsset`, `_Skeleton`), so `clutter()` finds no static mesh and nothing is placed |
| Alarm clock | Poly Haven `alarm_clock_01` | CC0 | 2K | BROKEN: same skeletal import; `build_scene.py` skips it ("imports without a static mesh") |
| Captured pieces | `ATCBoard::GraveyardSlot` (C++, lead) | - | - | DEGRADED: upright rows 10 cm beside the board, a lone pawn stands by the lamp base in `base_main` (545, 625); the reference shows none on the main view |

### Room

| Asset | Source | Licence | Resolution | State |
|---|---|---|---|---|
| Walls/floor/ceiling | `box()` of `/Engine/BasicShapes/Cube` with `damaged_plaster`, `dirty_tiles`, `old_linoleum_flooring_01` | CC0 | 2K, tiling 2-3 | DEGRADED: never visible in the main view (vignette + dark) |
| Bed frames x2 | Poly Haven `old_bed_frame` | CC0 | 2K | BROKEN: no texture imported (mesh + FBX material only); springs read as a blue-white wire grid lit by the `Window_Cold` rect light (2500 lm, 7500 K at y -150, right behind bed A) |
| Wheelchair, chair, drawer cabinet, pipes | Poly Haven | CC0 | 2K | OK (textures imported) |
| Metal office desk, fluorescent fitting | Poly Haven | CC0 | 2K | BROKEN: no textures imported (mesh/material slots only); out of the main view |
| Encyclopedia set on the desk | Poly Haven `book_encyclopedia_set_01` | CC0 | 2K | OK, out of view |
| Cell bars, rails, window bars | `/Engine/BasicShapes/Cylinder`/`Cube` + `rusty_metal_02` | CC0 | - | DEGRADED: primitive cylinders, 3 cm, hidden behind the beds in the main view |
| "WARD B" sign | `TextRenderActor`, engine font | - | - | DEGRADED: flat unlit text at z 205, above the top of frame; the reference stencils it on the wall at the opponent's shoulder |
| Window glow | emissive box | - | - | out of frame |

### Fetched but unused (cost download time, no value yet)

`lacquered_cherry_wood`, `smoke_speckled_veneer`, `rust_coarse_01`, `concrete_floor_worn_001`,
`painted_plaster_wall`, `cracked_concrete_wall`, the 8K `white_maple_veneer`/`dark_wood` (board.py fetches its own
4K), `binder_notebook`, `lightbulb_01`, `desk_lamp_arm_01`, `magnifying_glass_01`, `decorative_book_set_01`, and all
ten ambientCG sets of `fetch_ambientcg.py` (Scratches003/005, SurfaceImperfections003/008/013, Fingerprints002,
Smear005, Leaking004/006, Rust009).

### Provenance gaps in docs/FREE_ASSETS.md

Missing rows: `medical_tape`, `cigarette_pack`, `magnifying_glass_01`, `decorative_book_set_01`, `binder_notebook`
(all Poly Haven CC0) and the whole ambientCG set (CC0). The `chess_set` row says 8K, the board row says "8K fetched":
true on disk, but the build uses the 2K FBX geometry and 4K board sources. To fix in the Phase B commit that touches
FREE_ASSETS.md (this phase commits only this file).

## 2. Missing assets (against the reference's main view and detail panels)

| Needed | Why (reference) | Free source / plan |
|---|---|---|
| Heavy board frame with an iron band and rivets | main view: thick raised frame, metal edging, studs | own: `props.py chess_board()` v2 (no free asset matches the 55.3 cm board) |
| Worn, chipped, blood-stained piece look | "CHESS PIECES (DETAIL)" panel: chipped lacquer, dirt in grooves | material layers on the Poly Haven set: ambientCG `SurfaceImperfections013` chips, `Fingerprints002`, a curvature/AO-driven cavity grime mask baked from the 8K mesh |
| Hero table top with deep gouges, edge wear, worn varnish | main view: lighter worn patches, dark grime, chewed edges | `wood_cabinet_worn_long` or the table's own 4K scan + ambientCG `Scratches005` normal/roughness + a few own gouge decals with normals |
| Desk lamp that reads as the key | main view: glowing rim and bulb, hot pool on the table left | own dome lamp v2 (shade facing the seat, inner rim emissive); or Poly Haven `desk_lamp_arm_01` (fetched, unused) as a fallback |
| Rusty metal mug | main view right of the board | existing `tin_mug` with `rust_coarse_01` (fetched, unused) |
| Stencilled WARD B sign, window, bars at mid-frame | main view background | own decal (stencil texture from Courier Prime/own font) on the wall at z 150-180; bars as a modelled cell door instead of engine cylinders |
| Second environment | BOARD ENVIRONMENTS panel and the lead's benchmark gap | section 5 |

## 3. Import standard (every asset that reaches `L_Table`)

1. **Licence first.** CC0 (Poly Haven, ambientCG) preferred, CC-BY only with a credit row and an in-game credit. A row
   in `docs/FREE_ASSETS.md` in the same commit that first places the asset. Own assets name their generator script.
2. **Scale and axes.** Centimetres, Z up, +X away from the player. Poly Haven FBX is metres/Y-up and arrives correct
   through the FBX importer; own Blender props go through `props.py export()` (OBJ, `global_scale=100`, pre-rotated).
   Check: imported bounds within 5 % of the real object (board 55.3 cm, table top 75-80 cm high, mug 9-10 cm, pieces
   king 9-10 cm). `build_scene.py` already logs bounds for every prop: compare them, do not eyeball.
3. **Resolution choice is explicit.** Never "first `.fbx` in the folder": pick the file whose name ends in the wanted
   resolution (`HERO` in `fetch_polyhaven.py`), and fail if it is missing. Same for maps.
4. **UVs.** One non-overlapping UV channel for texturing; a second, lightmap-style channel only if a baked mask needs
   it (no static lighting is used). Own props: `smart_project` is acceptable for small props; hero props (board,
   lamp, clipboard) get seams placed by hand in the script (grain along the board frame, not across).
5. **Normals.** Poly Haven maps are OpenGL (`nor_gl`): flip green on import (done in `import_model` and
   `model_material`). Own textures write DirectX. A normal map with zero variance is an error, not a "flat but valid"
   placeholder (the stain normals are).
6. **Textures.** Colour maps sRGB `TC_Default`; normal `TC_NormalMap`; ARM/roughness/masks linear `TC_Masks` or
   `TC_Grayscale`; UI `TEXTUREGROUP_UI` without mips. Sizes: pieces 8K atlas (one atlas for 32 pieces), board 4K,
   table top 4K, hero props near the board 2K, room 2K, decals 1-2K. LOD group `World` (or `WorldNormalMap`) so
   streaming caps memory; no texture above 8K. Compression BC7 for hero colour (`TC_BC7`) where banding shows, else
   default DXT; never uncompressed in a shipped build.
7. **Materials.** Every placed mesh uses an instance of the layered master (`build_master_material`) with explicit
   maps (`model_material` for Poly Haven models, `make_mi` for own props); FBX-importer materials are never shown.
8. **Geometry, LOD, Nanite.** Static scanned meshes (table, beds, cabinet, chair, pieces): Nanite on (as
   `import_model` does). Own props: Nanite on when above ~5k triangles, else default LODs. Skinned or translucent
   parts (glass, wires) are not Nanite. Poly Haven FBX that arrive skeletal (`alarm_clock_01`, `cigarette_pack`) are
   imported with a static-mesh FBX option (`FbxImportUI.mesh_type_to_import = STATIC_MESH`,
   `import_as_skeletal = False`).
9. **Validation (build fails, not logs):**
   - every placed mesh has every slot on a `MI_*` of the master and a BaseColor texture unless it is listed as
     intentionally untextured (own props with tint-only MIs);
   - no Poly Haven model imports as a skeletal mesh; no placed model is silently skipped (the `clutter()`/`clock`
     skips become errors);
   - every normal map has non-zero variance; every texture has the compression/sRGB of its kind;
   - bounds check (item 2) for hero props;
   - FREE_ASSETS.md has a row for every source slug in `MODELS`, `TEXTURES`, `HERO_TEXTURES`, ambientCG `ASSETS`;
   - a scripted close-up per hero asset (capture.ps1 `-TCCamLoc/-TCCamTarget`, base colour and final) goes to the
     visual judge before an asset change is called done.

## 4. Board, pieces, table, props and room audit (base_main/base_black vs the reference)

- **Board.** Correct orientation in both seats (a1 dark, Black seat flipped). Squares are high contrast and clean at
  the edges; the reference's squares are worn pale in the centre ranks with grime in the seams and blood across
  several squares. Our frame is a thin flat rim with tiny studs; the reference frame is thick, raised and banded in
  metal with rivets. Blood: 4-5 splats, readable.
- **Pieces.** Good Staunton shapes and contact shadows. White pieces: an even ivory with a grainy speckle over whole
  bodies (rook and knight in the crop) and a bright, flat crown interior; black pieces: glossy and clean. The reference
  pieces are matte, dirty and chipped, the white ones closer to stained bone.
- **Table.** The worst surface in frame: dozens of straight pale/dark hairlines (stains.py Scratch decals) over a flat
  warm brown, which reads as straws rather than knife scars. The reference table is a heavily worn plank top with
  pale worn patches, deep dark grain and blood.
- **Captured pieces.** Upright in rows off the board; one white pawn stands alone at the lamp base in base_main. They
  should sit together, some toppled, in a dish or at the table edge (C++ change for the lead; see findings).
- **Lamp.** Dark enamel dome seen from outside, bulb hidden, no hot rim, no pool. In the reference it is the key light
  and the brightest object.
- **Props.** Books, mug, pill bottle, bowl and record sheets work; the tape roll is a pale blob, the clipboard on the
  cart is a pale tilted slab cut by the frame edge, the mug is wood-brown where the reference's is rusty tin.
- **Room.** The background is two bed frames at eye height with blue-white springs, the wheelchair top right, and black
  elsewhere. The reference's room (barred window, WARD B, cell bars, depth haze) is either above the frame or hidden
  behind the beds.

## 5. Board environments (reference panel) as post-beta level variants

One persistent level keeps everything the game logic needs (ATCBoard, cameras, seats, HUD hooks, opponents); each
environment is a **streamed sublevel** holding only the room shell, table, set dressing, lights and post volume.
`build_scene.py` gets an `ENVIRONMENTS` table and writes `L_Env_<Name>` sublevels; the menu (lead-owned C++/HUD)
loads one with `ULevelStreamingDynamic`. The table top height and board origin stay fixed (z of the board, camera
heights, hand poses all depend on them), so a variant may change the table model but must keep its top at the same
height (scale or sit the model to it). Each variant has its own benchmark camera set and metrics targets measured
from its reference thumbnail.

| Variant | Room shell | Table | Key dressing | Light (rendering architect) | Assets: have / missing |
|---|---|---|---|---|---|
| Institutional Oak (current) | plaster + tiled wainscot, linoleum | worn oak plank top | beds, wheelchair, bars, cart | warm dome lamp key, cold window | have all; fix the five findings below |
| Basement Table | `cracked_concrete_wall`, `concrete_floor_worn_001` (fetched, unused) | rough trestle (own) | `modular_industrial_pipes_01`, crates, damp streaks (ambientCG `Leaking004/006`) | bare `lightbulb_01` (fetched, unused) on a cord, very low fill | missing: crates/barrels (Poly Haven has CC0 crates) |
| Examination Room | `dirty_tiles` full height | steel examination table (own or the cart scaled) | `mounted_fluorescent_lights`, med cart, instrument tray | overhead fluorescent 5600 K key, flicker | missing: examination lamp, steel table top texture (ambientCG metal) |
| Abandoned Office | `painted_plaster_wall`, debris floor | `metal_office_desk` (needs its textures fixed) | `drawer_cabinet`, `book_encyclopedia_set_01`, `binder_notebook`, `desk_lamp_arm_01` | warm desk lamp + dusty window shafts | missing: paper debris decals (own `forms.py` variant) |
| Prison Cell | concrete, barred door (own model, replaces cylinders) | small bolted metal table | `old_bed_frame` as a bunk, bucket, high barred window | one cold window shaft, cyan grade | missing: cell door/bars model (own), bucket |
| Old Hotel | wallpaper + wainscot (CC0 wallpaper needed), carpet | dark lacquered table (`lacquered_cherry_wood`, fetched, unused) | wing chair, side lamp, curtains | warm tungsten practicals, red-brown grade | missing: wallpaper, carpet, curtain, armchair (search Poly Haven/ambientCG CC0) |

Order: Basement Table first (most assets already fetched; it also closes the lead's "second environment" benchmark
gap), then Prison Cell (reuses beds and bars), then the rest.

## Evidence

- `docs/graphics/baseline/base_main.jpg`, `base_black.jpg`, `metrics.json` (shared baseline, commit 7cb3a50).
- Build PC content listing 2026-10-13: `Content/TownChess/Models/{medical_tape,old_bed_frame,metal_office_desk}` hold
  no texture assets; `Models/{alarm_clock_01,cigarette_pack}` hold `_PhysicsAsset`/`_Skeleton`; `Models/chess_set`
  holds the `_2k` maps; `Textures/chess_set` holds both `_2k` and `_8k`.
- `ue5/assets/textures/stains/T_Stain_{Dirt,Ring,Scratch}_Normal.png`: per-channel pixel std 0.0 (measured with
  numpy); blood normals std 4-18.
_Incomplete: the board/environment specialist was stopped by the usage limit (2026-10-13) before writing the close-up evidence; its captures are on the build PC (C:\TownChess\shots). To be redone in its next run._

## Phase A findings

_Incomplete for the same reason. The lead's interim view (from sections 1-4, the judge and the director): scratch decals read as straw lines, the tape roll is a white blob, the clipboard sheet a pale slab, bed springs glow, rook crowns speckle; see docs/pipeline/visual.md._
