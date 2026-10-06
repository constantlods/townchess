# Visual judge report (stage 2)

Date: 2026-10-05. Run 3, base `de4a920`. The "since run 2" column compares with run 2, which judged `35-main.png`
(frame luma 85).
Judged images:
- `41-hud.png`: the only capture made after this milestone's code (b116cea, `-TCHud=1`).
- `40-main.png` and `40-opponent-closeup.png`: committed in cca78d3 at 00:14. That is **before** the quality preset
  (ea594b5, 03:49) and the HUD, so they are run-2 verification shots, not evidence for this milestone.
- `39-caged.png` and `39-annotator.png`.

The reference is `/root/townchess-work/reference-northstar.png`. Its main panel is 0..1045 x 0..685; the HUD detail
is in the top corners and the left column. `docs/reference/concept-reference.jpg` is the same image as a JPEG
(mean pixel difference about 2).

## Findings first (evidence)

1. **There is no visible evidence of the Epic + hardware-RT preset.**
   - Outside the HUD, `41-hud` and `40-main` differ only where pieces moved: mean absolute difference 6/5/4 in the
     centre crop.
   - Frame luma is 39 against 38, saturation 140 against 142, and board luma 81 against 80.
   - The reason: `capture.py` sets its own scalability (`-TCPreset`, default cinematic = 4) and has forced the
     HW-RT cvars since eebb6d6 (2026-10-04), ~128-134. Every reference shot has been taken at cinematic + HWRT
     since then, and the game's new `ATCGameMode::ApplyQualityPreset` changes nothing in these captures.
   - So the screenshots show what the captures always showed, not what players get. No committed image supports a
     claim that the game "looks better at Epic/HWRT". The game log line
     `quality: epic (level 4), hardware ray tracing on` from a packaged run on the RTX 4070 Ti SUPER would be the
     evidence.
2. **The HUD is the right layout but not the reference's typography.** Crops at 1:1 of the top-left, top-right
   and bottom.
   - Reference: player plates with a portrait thumbnail, the name in a clean sans, the rating with a small icon and a
     voice meter. The clocks are thin light sans figures. The action column has an icon per row (handshake, flag,
     gear).
   - Ours: Courier Prime everywhere, in caps and fairly heavy, on dark plates with a 1 px warm border. There are no
     portraits, no icons and no Settings row.
   - The typewriter face is right for the reference's panel captions ("MAIN GAMEPLAY VIEW", "FIND A GAME"), not for
     the plates and clocks. The commit and pass-40 note "reads like the reference's thin typewriter UI" overstates
     this.
3. **The plates are unbalanced.**
   - The left plate is the 250 px minimum ("PATIENT_65 / White 1200"). The right one grew to fit "THE PATIENT
     (warden)" (`DrawGame` `PlayerPlate`, `W = max(250U, Tw + 28U)`), so the two clocks sit at different x offsets.
   - Sides are swapped against the reference, which puts the opponent top-left and you top-right.
   - The AI plate shows "Black" with no rating, while the human plate shows one.
4. **The clock floats on the scene.** The "04:50" clock has no plate, and the lamp post runs straight behind the
   "04" (1:1 crop). Its only separation is a 1 px shadow. The reference has the same floating clocks, but over a
   near-black wall.
5. **The last-move markers are flat cream discs** under d7 and d5 in `41-hud`. Next to the reference, which marks
   nothing in the main view, they read as UI stickers lying on the board, not as light or wear. Hover uses the same
   decal style (`ATCBoard::RefreshMarkers` / `AddMarker`).
6. **The scene is unchanged since pass 39.** `39-caged` against `40-main` has a mean difference of 1.8/1.2/1.0, which
   agrees with the pass-40 note. So every scene row below is judged on the same pixels as the run-2 fixes. Exposure
   is much better than in run 2: frame luma 38 (reference 27, run 2 85), saturation 142 (reference 152).
7. **The cage still reads bronze-tan, not dark iron** (`40-opponent-closeup`).
   - The bars are square-section strips with a brow band and one rivet, all in a smooth tan with no rust breakup.
   - The face behind them is the best-rendered thing in the frame: wrinkles, a wet eye and warm skin.
8. **The player's hands are unchanged.** The left hand is still a raised fist resting on the bowl, and the right
   hand enters from the frame edge. There is no dirt, nail grime, veins or blood at gameplay distance. Opponent-crop
   luma is 40 against 22 in the reference, and the left-hand crop 74 against 44.

## Scores (0-10 vs reference)

| Element | Run 2 | Run 3 | Since run 2 | Note |
|---|---|---|---|---|
| Opponent: face | 6 | 6 | same | Strong in the close-up. At gameplay distance it is behind the cage |
| Opponent: body/pose | 4 | 4 | same | Arms folded on the table, upright. The hands still sit behind the black queen and king |
| Opponent: clothing | 4 | 4 | same | Off-white short-sleeved shirt, one strap with a ring. The reference has long canvas sleeves and cuffs |
| Mask (cage) | 4 | 4 | same | Greyer than in 35, still tan-bronze. Flat strips |
| Player hands | 3 | 3 | same | Fist on the bowl. Clean skin |
| Pieces | 5 | 5 | same | Ivory and ebony Staunton, clean plastic sheen. No chips or blood |
| Board | 4 | 5 | better | Luma 80 (reference 55, run 2 126). Inlay reads. Still clean, with only one splash |
| Blood / wear | 3 | 4 | better | The rank-6 strip is gone, and the splash at c3-d3 is irregular. Nothing on pieces, hands or table |
| Table | 4 | 4 | same | Brown, smooth, no gouges |
| Props / clutter | 3 | 3 | same | The lamp head is cropped, leaving a flat beige disc at the top left. Plain bowl and one mug. The reference has a lit lamp, a brass bowl, books and a tin cup |
| Environment | 3 | 4 | better | Dark again. Beds, wheelchair and bars read as an asylum. No WARD B in this frame |
| Lighting | 3 | 5 | better | Low key back (38). There is still no warm lamp pool on the board, and the lamp is not in shot |
| Camera / composition | 6 | 6 | same | Same framing. The opponent is small and the board dominates |
| UI / HUD | n/a | 5 | new | The layout matches: plates in the corners, clocks under them, actions on the left, status at the bottom. Typography and plate content do not (findings 2-4) |
| Black-seat view | n/a | n/a | n/a | No screenshot |

## Top 8 fixes (visual payoff per effort)

1. **Prove or drop the quality claim (low).** Capture one packaged frame at `-tcquality=high` and one at `epic` on
   the RTX PC, through the game camera rather than SceneCapture, and commit the pair together with the
   `quality:` log line.
2. **HUD typography (low).**
   - Draw the names, ratings and buttons in a free sans: Inter or IBM Plex Sans (OFL). Keep Courier Prime for
     captions and the "[TAB] GAME RECORD" hint.
   - Render the clocks in a light-weight face at about 1.6x.
   - Build the font in `ATCHUD::UiFont()` with a second runtime face, and raise `LegacyFontSize` to about 32 so the
     1.7x clock is not upscaled from a 20 px cache at 1440p and 4K.
3. **Plate content (low-medium).** Add a 48 px portrait per player and rating icons, each a small texture drawn with
   `DrawTexture`. Use one width for both plates: the max of both names. Put the opponent on the left, as the
   reference does.
4. **Clock legibility (low).** Give the clock a faint plate (alpha 0.35), or put it inside the player plate.
5. **Markers (low).** Replace the cream discs with a subtle warm emissive rim or a darkened square tint at about
   0.15 opacity. Do the same for hover.
6. **Lamp in shot with a pool (medium).** Lower or move the lamp so the shade and bulb enter the frame, as in the
   reference's top left. Give the shade an inner emissive, and aim a narrow warm spot at the board (`build_scene.py`
   lights block).
7. **Hands (medium).** Uncurl the left hand onto the board edge (fix the `ARM_TARGETS["player"]` reach errors from
   run 2). Add a sleeve cuff and dirt or blood decals on the knuckles and nails.
8. **Cage and plate metal (low).** Darken `MI_CageIron` toward a 0.05 base with rust breakup at about 0.3 roughness
   variance. On the Annotator plate, replace the square checker eye grid with round drilled holes (`annotator_mask`
   in props.py).

## Character design
- **Caged patient** (`40-*`, `39-caged`): the silhouette holds: cage head, pale shirt, forearms on the table. Against
  the reference and CHARACTERS.md he still lacks the long stained canvas sleeves, the leather wrist cuff and the
  clasped hands. The cage reads as tan sheet metal under the lamp. The face is excellent.
- **The Annotator** (`39-annotator`): he sits at the table with his ledger, and the plate has a riveted seam, which
  is an improvement. The plate is still a warm tan or bronze, not dark worked steel, and the eye grid is a square
  checker that reads as a sticker. The coat is dark green-grey. The forearms are bare (LIM-011), and the pose is the
  patient's folded arms.

## Not covered by any screenshot
Black seat, the menu ("FIND A GAME" against the reference panel), the promotion picker, check and checkmate states,
the draw-offer row, drag in progress, hover, and the Epic/HWRT preset. The reference has panels for promotion,
checkmate and find-a-game, and none of ours is captured.

## Checked
- Viewed `41-hud` and `40-main` (scaled), `40-opponent-closeup`, `39-caged` and `39-annotator`. Made 1:1 crops of
  the HUD corners, the bottom status, the clock glyphs and the board centre.
- Pixel stats: frame, board, opponent and hand luma and saturation, compared with the reference crops.
- Image diffs 39 to 40 and 40 to 41.
- The commit dates of the screenshots against the code commits.
- `ATCHUD` (TCGame.cpp 460-712): `UiFont`, `Plate`, `Button`, `DrawGame`, `DrawToRenderTarget`.
- `capture.py` HUD and quality handling.
- `ApplyQualityPreset` (TCGame.cpp 69).
