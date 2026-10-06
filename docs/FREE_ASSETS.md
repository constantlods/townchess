# Free assets register

Owner rule: the best quality possible with **free** assets only (CC0 preferred, CC-BY with credit), and our own code
where free assets fall short. No paid assets, nothing ripped from commercial games.

## Third-party (all CC0 unless stated)

| Asset | Source | Licence | Resolution | Used for |
|---|---|---|---|---|
| chess_set (pieces + original board) | https://polyhaven.com/a/chess_set | CC0 | 8K | The 32 pieces |
| white_maple_veneer, dark_wood | https://polyhaven.com/a/white_maple_veneer, https://polyhaven.com/a/dark_wood | CC0 | 4K (baked) / 8K fetched | Board squares (baked by `ue5/tools/textures/board.py`) |
| smoke_speckled_veneer | https://polyhaven.com/a/smoke_speckled_veneer | CC0 | 8K | Alternative dark squares |
| wood_cabinet_worn_long | https://polyhaven.com/a/wood_cabinet_worn_long | CC0 | 4K | Board frame |
| wooden_table_02, wood_table_worn | https://polyhaven.com/a/wooden_table_02, https://polyhaven.com/a/wood_table_worn | CC0 | 4K | Table |
| lacquered_cherry_wood | https://polyhaven.com/a/lacquered_cherry_wood | CC0 | 4K | Lacquer reference for pieces |
| rusty_metal_02, rust_coarse_01 | https://polyhaven.com/a/rusty_metal_02, https://polyhaven.com/a/rust_coarse_01 | CC0 | 4K | Cage mask, bars, lamp, cart, mug |
| brown_leather, rough_linen | https://polyhaven.com/a/brown_leather, https://polyhaven.com/a/rough_linen | CC0 | 4K / 2K | Ledger, cloth |
| dirty_tiles, damaged_plaster, old_linoleum_flooring_01, concrete_floor_worn_001, painted_plaster_wall, cracked_concrete_wall | polyhaven.com/a/<slug> | CC0 | 2K | Room surfaces |
| old_bed_frame, wheelchair_01, metal_office_desk, drawer_cabinet, painted_wooden_chair_01, book_encyclopedia_set_01, modular_industrial_pipes_01, mounted_fluorescent_lights, alarm_clock_01, desk_lamp_arm_01, lightbulb_01 | polyhaven.com/a/<slug> | CC0 | 2K | Room props |
| MetaHuman (Walter preset, wardrobe, grooms) | Unreal Engine MetaHuman Creator 5.8 | Epic MetaHuman licence (free for UE projects; no AI training) | Cinematic pipeline | Opponents and the player's arms |
| UE template mannequins (fallback) | Unreal Engine templates | UE EULA | — | Fallback when no MetaHuman is built |
| Patrick Hand, Courier Prime | Google Fonts | SIL OFL 1.1 (licences in `ue5/assets/fonts`) | — | Clipboard game record; Courier Prime Regular also for the HUD's section titles |
| Lato Light, Lato Regular | https://github.com/google/fonts/tree/main/ofl/lato | SIL OFL 1.1 (`ue5/assets/fonts/OFL-Lato.txt`) | — | HUD text (names, clocks, menus, action list) |
| Stockfish 19 | https://github.com/official-stockfish/Stockfish/releases/tag/sf_19 | GPL-3.0, separate process only (`tools/engines/SOURCE.txt`) | — | League opponents, simulator referee |

All Poly Haven downloads are scripted (`ue5/tools/fetch_polyhaven.py`, hero resolutions in `HERO`/`HERO_TEXTURES`).

## Our own (generated in this repository)

| Asset | Generator | Output |
|---|---|---|
| Cage mask, Annotator plate/coif/sleeves, ledger, pencil, tin mug, dome lamp, med cart, clipboard, wooden chessboard | `ue5/tools/blender/props.py` (Blender, scripted) | `ue5/assets/props/*.obj` |
| Blood decals (spatter, pool, smear, drips: colour/coverage, relief, gloss) and handling-grime masks | `ue5/tools/textures/blood.py` (numpy/scipy/pillow, `tools/.venv`) | `ue5/assets/textures/blood`, `.../grime` |
| Inlaid board surface (maple/walnut composite, joints, scratches, wear) | `ue5/tools/textures/board.py` | `ue5/assets/textures/board` |
| Grime mask (blotches, streaks, smudges) | `build_scene.py` `grime_png` | built into the level |
| Table stains: mug rings (dried rim, faint film, broken where the mug tilted) and handled-grime patches (greasy blotch with wipe streaks) | `ue5/tools/textures/stains.py` | `ue5/assets/textures/stains` |
| Piece sounds: wooden move "clack" and heavier capture (synthesised: modal resonances of a wood block plus a felt thud) | `ue5/tools/audio/clack.py` | `ue5/assets/sounds/S_TC_Move.wav`, `S_TC_Capture.wav` |

## Credits

No CC-BY assets are in use yet. If one is added, credit it here and in the game's credits screen.
