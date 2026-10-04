# Visual rebuild: loop log and roadmap

The visual north star is the owner's reference sheet (main gameplay panel). It is kept on the build PC
(`C:\TownChess\reference picture.png`) and is not committed to this public repository. Every pass is judged by a
screenshot from the player's seat, captured with `ue5/tools/win/capture.ps1` (RTX 4070 Ti SUPER, cinematic
scalability), and compared against the reference. `-Source basecolor` captures the G-buffer to debug materials.
The critique that drives the passes is in [HOSTILE_VISUAL_REVIEW.md](HOSTILE_VISUAL_REVIEW.md).

## Passes so far (2026-10-04, `docs/screenshots/visual-loop/`)

| Pass | Change | Verdict against the reference |
|---|---|---|
| 00 baseline | Template mannequin, chrome XR gloves, FBX-import materials, 24 mm camera from 50 cm above the table | A tech demo: robot opponent, both armies the same grey, clean CG board, top-down camera |
| 01 | Layered master material (our procedural grime mask: blotches, streaks, smudges; roughness maps) | **Regression**: sampler/compression mismatch broke the material (world grid). Found with the base-colour capture |
| 02 pass 1 | Sampler fix; camera fitted to the reference (42 cm eye, 87 cm back, 30 mm, f/2.8); key moved to the player's side; fill 2200 to 150 lm | Framing close to the reference; the pieces read; the mannequin now reads as glossy white plastic (worse) |
| 03 pass 2 | Blender-authored cage mask and tin mug (`ue5/tools/blender/props.py`); clothed opponent; leather gloves; tiled dado, damaged plaster, linoleum, bed frames | Bed frames add depth; the props imported on their side (OBJ axes); the lamp was unlit; the gloves were out of frame |
| 04 pass 3 | Dome lamp with the key at its bulb; OBJ axis fix; gloves into view; worn wood table | Lamp practical and gloves visible; the armies still matched (the "black" set is grey marble) |
| 05 pass 4 | Mask attachment fixed (movable); ebony tint on the black set; desaturated cloth; lamp spill on the opponent | Ebony against boxwood like the reference; the head was cropped at pitch -20 |
| 06 pass 5 | Pitch -15 so the head and mask stay in frame | Composition matches the reference's layout: lamp at upper left, opponent between bed silhouettes, mug at right, gloves at the bottom corners |

## Remaining gaps, ranked (what the next passes do)

1. **The opponent is a mannequin.** The cage mask helps, but body, hands and cloth read as a wooden figure. This is
   not closable procedurally. Plan: MetaHuman (free with UE; Creator runs in the editor and can be scripted in 5.8)
   with a custom institutional outfit and the clasped-hands pose. **Needs the owner to sign in to Epic in the editor
   on the build PC** (auto-rig and texture synthesis are cloud services).
2. **Hands**: XR gloves with no forearms. MetaHuman arms with sleeves, first-person rendering, resting on the board
   frame. Same owner sign-in.
3. **Board and table wear**: grime is there but too uniform; add blood and ring decals, edge wear, and replace the
   marble board look with aged wood and ivory squares.
4. **Room storytelling**: "WARD B" stencil, papers, books and a tray on the table, a barred window that the camera
   actually sees, a cold corridor light behind the opponent.
5. **Grade and exposure**: lift the cold ambient a stop on the back wall; teal shadows and warm highlights; mask
   specular highlights.
6. **Runtime target**: profile the same view on the RX 6650 XT (VM 131) once the opponent asset is in.

Gameplay is untouched by these passes: the board, pieces and rules come from the C++ board actor and the core; each
capture runs a live engine game (`-tcauto`).
