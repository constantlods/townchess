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

| 07 | MetaHuman opponent (default face) built with `Scripts/mh_opponent.py`; body and face as skeletal mesh actors, face linked to the body (leader pose) by ATCGameMode | A real person at the table; wrong face; underwear top; mask too high; arms hanging |
| 09 | Opponent rebuilt from Epic's Walter preset (owner ran the cloud steps in the editor); mask lowered onto the face | The older face behind the cage reads well; the torso rendered as a hole (outfit meshes missing) |
| 10 | Outfit meshes spawned as leader-pose followers | Older man in the cage mask, hands on the table (`10-metahuman-walter.png`) |

| 11-13 | Opponent roster (caged patient, the Annotator: Blender plate mask, coif, ledger); game-record clipboard on a cart | Roster switching works; clipboard legible at 1080p |
| 14-22 | Reference pass: exposure, bars, WARD B, blood (procedural), aged board; clasp pose solved by search; the player's own MetaHuman arms; camera pitch -19 | Composition matches the reference: real hands at the board corners |
| 23 | Cinematic MetaHuman build (full skin shader) | Close-up face with real skin detail |
| 24-27 | Generated blood decals; Blender wooden board; baked 4K inlaid maple/walnut squares; pieces ignore decals | Inlaid board with blood in the joints; red, not ink-black |
| 28-31 | Visual-judge fixes: grading (sat 0.72), lamp 450 lm, board toned down, blood edge fade, forward lean (arms folded on the table), thicker cage wire, brass bowl | Board and tones closer; cage still copper-orange; hands still lack veins/dirt (open) |

| 32-35 | Hand vein/dirt decals (generated), dark-iron cage material, straitjacket webbing straps | Straps read; hand decals weak and later bisected as the cause of a 2x exposure jump (off by default) |
| 36-39 | Annotator at his desk (forearms on the table), dark steel plate, coat sleeves; pipeline run 2 fixes | Exposure back to mean ~37 (reference ~27); left player hand still a fist; cage still bronze-tan (rust tint lowered next) |
| 40-41 | Gameplay feel (drag and drop, 0.2 s ease-out moves, captures in parallel, hover, snap-back, wood sounds); quality preset (Epic + hardware ray tracing on RTX); reference-style HUD (Courier Prime, translucent bordered plates, clocks under the plates, status at the bottom), now captured with the scene (`-TCHud=1`) | `41-hud.png`: the HUD reads like the reference's thin typewriter UI and stays off the opponent's face; the scene itself is unchanged from pass 39 |
| 42-46 | Cage as blackened iron (metal 0.85 -> 0, base 0.07 -> 0.012), darker cell bars, player fingers relaxed toward the reference pose; HUD redone after visual-judge run 3: Lato for play text, monospace only for titles, player cards with thin clocks, quiet action list, FIND A GAME panel | `45-hud-game.png`: from the seat the cage now reads dark iron and the left hand is open, not a fist; HUD typography matches the reference. `44-cage-before-after.png`: in close-up under the lamp the cage is still dark brown (its base colour is near-black; the lamp just above lights it). No portraits or icons in the HUD yet |
| 47 | Owner: pieces hide behind each other, still low quality. Seat height on the mouse wheel (0 = old view, default 0.6: 28 cm higher at 1, 10 deg steeper, 30 -> 24 mm so the opponent's face stays in frame); grading measured against the reference panel; aged/dirty pieces and squares; capture now uses the level's post settings (its exposure had not followed the volume) | `47-view-heights.png` (0 / 0.6 / 1): from 0.6 up no piece hides another. `47-main-view06.png` against the reference: mean brightness 27.2 vs 26.6, green/blue 1.69 vs 1.62, red/green 1.52 vs 1.44; highlights 120 vs 97 (still hot: the white pieces); fine detail 10.5 vs 12.9 (the reference's clutter and dirt) |

## Remaining gaps, ranked (what the next passes do)

1. **The opponent's styling.** The T-shirt is clean white; it needs stained, drab institutional clothing, sleeves,
   and the clasped-hands pose of the reference. Owner decision pending: the approved "Annotator" character concept
   versus the current caged patient (which is also close to a well-known film look; see PROJECT_AUDIT.md).
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
