# Renderer audit (Phase A)

Owner: rendering architect. Date: 2026-10-13.

Inputs:
- the shared baseline `docs/graphics/baseline/` (base_main/black/hands/opponent, metrics.json) compared with
  `docs/reference/concept-reference.jpg` (main gameplay panel, crop 0,0-1045,685);
- the code and config at `a82c55d`;
- live measurements on the build PC with the packaged build of 2026-10-06 and the editor `-game`.

Performance numbers and method are in [PERFORMANCE_BENCHMARKS.md](PERFORMANCE_BENCHMARKS.md). No scene or config
was changed in this phase.

## 1. The pipeline that actually renders (RTX 4070 Ti SUPER, default "auto")

These values were read live from the packaged game with `-ExecCmds` cvar queries, after `ApplyQualityPreset` had run
(log line `quality: epic (level 3), hardware ray tracing on`). "Set by" is UE's `LastSetBy`.

| Area | Live value | Set by | Notes |
|---|---|---|---|
| RHI | D3D12 SM6 on the RTX (adapter 0) | engine | iGPU not used |
| Scalability | sg.* = 3 (Epic) except sg.ResolutionQuality = 0 | `ApplyQualityPreset` (Console) | the GameUserSettings.ini in the build also stores sg 3, 1280x720, FullscreenMode 1 (test runs) |
| **Screen percentage** | `r.ScreenPercentage 0`, `r.ScreenPercentage.Default.Desktop.Mode 1` → **1552x873 at 2560x1440 (60.6%)** | Constructor | Nothing in the project sets it; ProfileGPU shows `TemporalSuperResolution 1552x873 -> 2560x1440` |
| Anti-aliasing / upscaler | TSR (`r.AntiAliasingMethod 4`), history 200% (5120x2880), 16 samples | ProjectSetting / Scalability | DLSS absent (LIM-012); `r.NGX.DLSS.Enable 1` is a no-op |
| Post sharpen | `r.Tonemapper.Sharpen 1` | DefaultEngine.ini [SystemSettings] | added to make up for the soft TSR frame (pass 49) |
| GI | Lumen (`r.DynamicGlobalIlluminationMethod 1`), **hardware RT**, lighting mode 0 (surface cache), screen probe downsample 16, short-range AO on | Project / Console / Scalability | runs on async compute, 6.1 ms per frame |
| Reflections | Lumen reflections, HW RT, screen traces on, max roughness to trace 0.4 (default) | Project / Console | 0.35 ms |
| **Shadows** | **RT shadows** (`r.RayTracing.Shadows 1`) on every shadow-casting light, SSD denoiser; VSM enabled but unused at Epic (ShadowDepths 0.001 ms) | Console (ApplyQualityPreset) | 10 lights cast shadows; see D2 |
| Contact shadows | `r.ContactShadows 1`, but no light sets a contact shadow length | build_scene.py | contact shadows are effectively off |
| AO | Lumen short-range AO; SSAO not used (`r.AmbientOcclusionLevels -1`, Lumen owns AO) | defaults | |
| Skin | Subsurface profile, `r.SSS.Quality 1`, full-res | Scalability | 0.18 ms; Substrate off |
| Volumetric fog | on, 8 px grid, 128 slices; density 0.035, falloff 0.002 | Scalability / build_scene.py | 0.19 ms + translucency volume 1.65 ms (async) |
| DOF | Cine camera 30 mm, f/2.8, focus 97 cm; `r.DepthOfFieldQuality 2` | build_scene.py | depth of field is about 18 cm deep (89-107 cm), but the blur on the board is under 1 px at 1440p: 0.2 ms for no visible effect |
| Exposure | Histogram AE with min = max = EV100 8.3, i.e. fixed | build_scene.py post block | |
| Grade | saturation 0.72, contrast 1.06, gain (0.84,1,0.96), **highlight gain 0.74**, cool shadow gain; vignette 0.65; grain 0.5; fringe 0.15; bloom 0.3 | build_scene.py post block | tuned against V1 numbers; see D4 |
| Motion blur | off (project default) | ProjectSetting | |
| Textures | `r.Streaming.PoolSize 1000` (Epic default), RHI texture pool 9.6 GB, VT on | Scalability | no over-budget warning in the logs |
| PSO cache | none shipped; 69-77 PSO precache misses per start, all in the first 7 frames on this PC | packaging | hitches on a first run elsewhere |

**Screenshot path vs. game path.** All baseline and judge images come from `Scripts/capture.py`, which renders a
`SceneCapture2D` into a render target of the requested size (1920x1080 for the baseline).
- The default `-TCPreset` is **cinematic** (sg 4), not the game's epic.
- Only the post-process volume's settings are copied to the capture.
- Scene captures are not driven by `r.ScreenPercentage`.

So the judged frame is a full-resolution 1080p render. The owner sees a 1552x873 frame that TSR upscaled to 1440p and
then sharpened. Nobody has scored or measured the image the owner actually looks at. This is consistent with the
owner's complaint ("still low quality") and with the earlier pass-49 measurement of a real TSR frame: fine detail 9.2
against 12.9.
- **Verification still open:** ProfileGPU on a frame that renders the capture would print the capture's own view size.
  That frame was not profiled in this phase.

## 2. Limits

- **GPU-bound everywhere.** Game thread 1.3 ms, render thread = GPU time + 0.5 ms, GPU 95-99% busy.
- **Lighting dominates.** At 60.6% resolution, RT shadows and their denoiser cost 6.3-7.0 ms of an 11.3-12.2 ms GPU
  frame. Native 1440p costs 25.9 ms (38 fps). The owner's 1440p frame cannot be rendered at native resolution until
  the lighting cost drops.
- **No upscaler better than TSR** until the owner installs the DLSS plugin (LIM-012).
- **No presented measurement is possible over SSH.** Swapchain creation fails in session 0
  (`DXGI_ERROR_NOT_CURRENTLY_AVAILABLE`). S3 needs a run in the owner's desktop session.
- **Offscreen runs measure only the graphics queue in CSV.** Lumen's async work (6 ms) shows only in ProfileGPU.
- **RX 6650 XT:** no measurement of the current scene (VM 131 stays stopped without the lead).

## 3. Baseline against the reference (measured)

Luminance at the reference panel's scale (1045 px wide). Script: `tools/.venv` + PIL.

| | Reference | base_main | Meaning |
|---|---|---|---|
| Pixels below luma 8 | 33.8% | **47.7%** | our shadows crush; the reference keeps the room visible |
| Median / 25th percentile | 15.0 / 5.1 | **9.3 / 1.9** | as above |
| 95th / 99.9th percentile | 97.1 / 232.9 | 103.0 / 217.8 | similar mid-highs; fewer true specular peaks |
| Mean saturation | 0.62 | 0.52 | global 0.72 saturation |

Mean luma on a 4x5 grid (rows top to bottom; the lamp is at row 2-3, column 1):

```
reference                          base_main
 12.4  20.7  20.8  25.7  10.8       16.2  12.0  14.4   9.2  15.7
 36.0  23.5  19.2  21.5   4.9        7.2  26.1  32.7  25.1  11.3
 29.9  58.0  65.9  37.6  16.3       14.5  64.4  49.4  25.0  29.0
 31.1  21.6  42.0  23.3  22.3       32.0  51.9  49.0  29.6   9.2
```

What the grid shows:
- In the reference, the brightest cells are the board centre and the lamp column.
- In ours, the **lamp column is dark** (7.2 against 36.0) and the **bottom row** (hands and the near edge of the
  table) is as bright as the board (51.9/49.0 against 21.6/42.0). The frame is lit from the camera's side, not by the
  practical lamp.

What the images show:
- In the reference, a glowing lamp throws a warm pool with falloff, glossy pieces carry specular highlights, the
  hands are modelled by side light, and the room behind reads through haze.
- In base_main the board is evenly lit edge to edge, the lamp shade is a dark dome, and the pieces are matte (white
  pieces at roughness 0.72, darkened in pass 54 because they were "the frame's hottest object").
- Skin is evenly orange (base_hands), the background is black with no haze, and grain is visible on every surface.

## 4. Defects: cause, fix, cost, verification

**D1. The player sees a 60.6%-resolution TSR frame; the judged frame is a full-resolution scene capture.**
- Cause: no screen percentage is set, so UE's display-based automatic mode picks 1552x873 at 1440p. `capture.py`
  renders a separate SceneCapture2D at full render-target size and defaults to cinematic.
- Fix:
  - (a) Set the screen percentage explicitly per tier in `ApplyQualityPreset` (lead): Epic 100% (TSR as native AA,
    or DLAA once DLSS is installed) after D2, otherwise 75% as the floor; High 67%; Medium 58%.
  - (b) Make evaluation captures go through the same path. Default `-TCPreset` to the game's own preset (auto) rather
    than cinematic. Either capture the real viewport in the owner's session, or give the capture the same screen
    percentage and TSR (lead: `capture.py`).
  - (c) Lower `r.Tonemapper.Sharpen` to 0.5 once the frame is native.
- Cost:
  - Measured today: 75% costs +4.1 ms (84.8 → 62.9 fps) and 100% costs +14.5 ms (37.9 fps).
  - With D2 fixed, the estimate for 100% is about 13-14 ms (about 70 fps). This must be measured.
- Verification:
  - ProfileGPU in the packaged build shows `TemporalSuperResolution 2560x1440 -> 2560x1440` (or 1920x1080 at the 75%
    floor).
  - V2 detail measured on a frame that went through that path.
  - S3: average ≥ 60, 1% low ≥ 45.

**D2. Ten shadow-casting local lights; fills cost 50x the key.**
- Cause: every helper light in the build_scene.py lighting block keeps `cast_shadows` on. These are Fluorescent_Fill,
  Window_Cold, Rim (point light, 8 cm source radius), Lamp_Opponent, BackWall_Wash, Hands_Key, Table_Right and
  Corridor_Glow; only Lamp_Bulb has shadows off.
  - At Epic each one gets an RT shadow ray pass plus a share of an SSD denoiser batch.
  - Lamp_Key costs 0.105 ms. Rim, Window_Cold, Corridor, Fluorescent, BackWall, Hands_Key and Table_Right together
    cost about 5 ms. The batches are 2.27, 2.71 and 0.72 ms (ProfileGPU, PERFORMANCE_BENCHMARKS.md).
  - VSM costs the same (6.25 ms).
  - The two shadow methods give images that differ by 2.0/255 on average. The extra shadows buy nothing visible.
- Fix:
  - Keep shadows on Lamp_Key and Lamp_Opponent, and on Window_Cold only if its bars or window shadow are wanted in
    frame.
  - Set `cast_shadows False` on Rim, Fluorescent_Fill, BackWall_Wash, Corridor_Glow, Hands_Key and Table_Right.
  - Halve Rim's source radius if it keeps a shadow.
  - Optional RTX experiment: MegaLights (UE 5.8), which has a fixed cost however many shadowed area lights there are.
- Cost: saves about 4-4.5 ms at 60.6% (estimate from the per-light profile) and about 12 ms at native.
- Verification:
  - CSV `GPU/Lights + GPU/ShadowsDenoiser` ≤ 2.5 ms at 60.6% (≤ 5.5 ms at 100%).
  - A main-view capture before and after differs only where a removed shadow was visible (mean abs diff < 3/255).
  - The visual judge sees no lost grounding.

**D3. The practical lamp is not a light source in the frame; the hands and near table are lit from the camera.**
- Causes:
  - The lamp: `M_TC_LampInner` emits 2.5 and `M_TC_Bulb` 60, with the bulb hidden inside the dome. At fixed
    EV100 8.3 the exposure scale is about 1/(1.2·2^8.3) ≈ 0.0026, so mid-grey needs about 68. The shade interior
    sits about 4-5 stops below mid-grey and renders black; the window glow (6.0) is the same.
  - The hands: the `Hands_Key` rect light (200 lm, 2600 K, 40 cm from the hands, aimed from the camera side) and the
    `Table_Right` spill (80 lm) light the foreground frontally. Frontal fill flattens form: the "flat orange skin",
    and the bottom-row luma of 52 against the reference's 22.
- Fix:
  - Lamp inner emissive about 150-300 and a bulb in view at about 2000+ with bloom, so the lamp glows like the
    reference. Emissive values are the materials role's; the mesh or bulb placement is board/environment's.
  - Move Hands_Key to the lamp side at about 45° and about half the lumens, or remove it and let Lamp_Key plus Lumen
    bounce model the hands.
  - Tighten the key's pool: inner/outer cone so the board centre is brightest and falloff reaches the board edge.
- Cost: under 0.1 ms.
- Verification on the grid above:
  - lamp-column cell (row 2, column 1) ≥ 25;
  - bottom-row mean ≤ the board-centre cells;
  - board centre is the brightest cell;
  - V1 still met;
  - judge lighting row ≥ 6.

**D4. The grade and the V1 numbers are standing in for lighting: speculars compressed, shadows crushed, grain counted as detail.**
- Cause:
  - The post block compresses highlights (gain_highlights 0.74), desaturates globally (0.72), adds contrast 1.06,
    cool shadow gain, vignette 0.65, grain 0.5 and sharpen 1.0.
  - The materials were darkened and roughened to keep p95 ≤ 105 (white pieces at roughness 0.72, pass 54).
  - Result: 47.7% of pixels below luma 8 against 33.8%, and specular peaks missing (99.9th percentile 217.8 against
    232.9).
  - Flat mid-tone regions carry more high-frequency energy than the reference (Laplacian 16.3-16.7 against 15.7):
    the grain feeds the V2 "fine detail" metric.
- Fix:
  - Neutral-ish grade: highlight gain 1.0, saturation about 0.85, vignette about 0.4, grain 0.15-0.2.
  - Hit V1's p95 through light ratios and EV, not by flattening highlights. Let small specular peaks clip, as the
    reference does.
  - Request to materials: pieces as lacquer, roughness about 0.3-0.4.
  - Ask the lead to measure V2 with grain at 0 as well.
- Cost: none on the GPU.
- Verification:
  - V1 within range;
  - pixels below 8 ≤ 38%; median ≥ 12; 99.9th percentile ≥ 225;
  - V2 ≥ 11.5 with grain 0;
  - the judge sees glossy highlights on the pieces.

**D5. No atmosphere and a black background: the volumetric fog is paid for but invisible.**
- Cause:
  - Fog density 0.035 with only a 0.07 sky light.
  - The lights that would scatter (Window_Cold, scattering 3.0, and Corridor_Glow) point at the back wall behind
    the bars.
  - Vignette 0.65 and the cool shadow gain push the room to black: top-row luma 9-16 against 12-26.
  - The reference reads the ward through haze, a lit window and the WARD sign.
- Fix:
  - Raise the fog's scattering where light passes through it (window and corridor beams crossing the opponent's
    back), with fog density about 0.05-0.08 and a lower height falloff.
  - Keep the sky light low and use local light shafts rather than flat ambient.
  - Lower the vignette (D4).
- Cost: +0.1-0.3 ms (8 px grid already paid).
- Verification:
  - top-row grid mean ≥ 15 with visible light shafts behind the opponent;
  - pixels below 8 ≤ 38%;
  - the judge's background row ≥ 6.

**D6. No contact shadows.**
- Cause: `ContactShadowLength` is 0 on every light.
  - At Epic, RT shadows ground the pieces. At High, which uses VSM and is the RX tier, small contact gaps (piece
    feet, fingertips on the board) lose definition.
  - In the 2560x1440 captures the resting left hand shows no darkening where the palm meets the table.
- Fix: contact shadow length about 0.02-0.03 (screen space) on Lamp_Key and Lamp_Opponent.
- Cost: about 0.1 ms.
- Verification: close-up capture (`-TCCamLoc` near the hand and the pieces) shows contact darkening at High; no
  halos at Epic.

**D7. Sleeve banding is geometric, not shading.**
- The RT and VSM captures of the sleeve are identical, so the stair-step bands come from faceted geometry or
  normals, not from shadow terminators.
- Request to hands/character (wearables in `props.py`): smooth normals or a higher-segment sleeve.

**D8. Depth of field costs 0.2 ms for under 1 px of blur.**
- f/2.8 at 30 mm and 97 cm gives a circle of confusion of about 0.7 px on the near rank and about 1.6 px on the back
  wall at 1440p.
- Either make it deliberate (about f/1.4-2.0 with focus on the board, which the visual director decides) or turn it
  off.

**D9. No shipped PSO cache.**
- 69-77 PSO precache misses per start.
- Request to lead: record and bundle a stable pipeline cache (or rely on PSO precaching plus a warm-up) before beta.

## 5. Recommended configuration

### RTX 4070 Ti SUPER (Epic, 1440p, target ≥ 60 avg / ≥ 45 1% low presented)

| Setting | Value | Why |
|---|---|---|
| Screen percentage | 100 (native TSR, or DLAA when DLSS is installed); 75 if D2 is not yet done | D1 |
| Shadows | RT shadows on Lamp_Key and Lamp_Opponent only (others no shadow); or VSM, which looks and costs the same here | D2 |
| Lumen | HW RT on; `r.Lumen.HardwareRayTracing.LightingMode 2` (hit lighting for reflections) as a test for the glossy pieces | reflections on lacquer once D4 is done |
| TSR | Epic history (200%) kept; `r.Tonemapper.Sharpen 0.5` | less halo and grain amplification at native |
| Post | grain 0.15-0.2, vignette 0.4, highlight gain 1.0, saturation about 0.85 | D4 |
| Fog | volumetric, 8 px grid, density 0.05-0.08 with lit beams | D5 |
| Contact shadows | key and opponent lamp, 0.02-0.03 | D6 |
| DOF | off or deliberate | D8 |
| Expected | about 70 fps at native after D2 (estimate; must be measured) | |

### RX 6650 XT (High, 1440p, Vulkan SM6 in VM 131 or D3D12 on Windows, 8 GB)

| Setting | Value | Why |
|---|---|---|
| Screen percentage | 67 with TSR (re-test FSR only if a Linux/Vulkan plugin exists) | measured as the 1440p sweet spot on this card (PERFORMANCE.md) |
| Lumen | **software** (`r.Lumen.HardwareRayTracing 0`), screen traces on | HW RT was 4% slower on RDNA2 for no visible gain |
| Ray tracing | `r.RayTracing.Shadows 0`; consider `r.RayTracing 0` at startup for this profile to drop BVH memory | VRAM (5.3 GB peak with both structures, PERFORMANCE.md) |
| Shadows | VSM, `r.Shadow.Virtual.SMRT.RayCountLocal 4`, shadows on key lights only (D2) | |
| Contact shadows | on (D6) | replaces RT shadow detail |
| Volumetric fog | grid 16 px | |
| Translucency | `r.Lumen.TranslucencyVolume.Enable 0` if nothing translucent needs GI | 1.65 ms (async) on RTX; relatively more on RDNA2 |
| Textures | `r.Streaming.PoolSize` about 2500, VT pool checked against 8 GB | MetaHuman 8K skin |
| Expected | about 50 fps today, about 60 after D2 (**estimate** from the RTX's High at 8.1 ms × 2.3-2.5) | needs a VM 131 run with the lead's approval |

## 6. Requests to other owners

| To | Request |
|---|---|
| lead | `ApplyQualityPreset`: explicit `r.ScreenPercentage` per tier (D1), per-tier shadow and contact settings once agreed. `capture.py`: default preset = the game's preset; a capture path that matches the game view (D1). A presented S3 run in the owner's session. A shipped PSO cache (D9). |
| materials | Lamp inner and bulb emissive (D3), piece roughness about 0.3-0.4 (D4); check that the player skin MIs use a subsurface profile (flat orange skin, base_hands). |
| board/environment | A bulb visible under the shade (D3). |
| hands/character | Sleeve faceting (D7). |
| visual director | DOF intent (D8), lamp pool framing. |

## Phase A findings

Ranked by impact on what the owner sees, each with an acceptance test that can fail.

| # | Failure | Fix | Acceptance test | Effort | Owner |
|---|---|---|---|---|---|
| 1 | The owner plays a 1552x873 frame upscaled to 1440p (auto screen percentage 60.6%), while every baseline and judge image is a full-resolution cinematic scene capture: the "low quality" frame is never measured | Explicit screen percentage per tier (Epic 100, or 75 until D2 lands; High 67); captures through the game's preset and screen percentage path; sharpen 0.5 | Packaged ProfileGPU shows TSR `2560x1440 -> 2560x1440` on the RTX. V1/V2 re-measured on a game-path frame (V2 ≥ 11.5 with grain 0). S3 avg ≥ 60, 1% low ≥ 45 | S (C++ few lines) + M (capture path) | lead (ApplyQualityPreset, capture.py); RA verifies |
| 2 | 10 shadow-casting lights: RT shadows + denoiser are 57% of GPU time (6.3-7.0 of 11.3-12.2 ms); the key light costs 0.1 ms, the fills about 5 ms, with no visible gain (RT vs VSM differ by 2/255) | Shadows only on Lamp_Key and Lamp_Opponent (Window_Cold optional); smaller Rim radius; optional MegaLights test | CSV `Lights + ShadowsDenoiser` ≤ 2.5 ms at 60.6%; native 1440p ≥ 60 fps avg offscreen; before/after capture mean diff < 3/255 | S | rendering architect |
| 3 | The lamp is not a light source in frame (lamp cell luma 7 against 36) and the hands/near table are lit from the camera (bottom row 52 against 22): flat skin, flat board, no pool | Lamp emissive about 150-300 inner, bulb visible about 2000+; Hands_Key to the lamp side at half power or removed; tighter key cone | Grid: lamp cell ≥ 25, board centre brightest, bottom row ≤ board centre; V1 met; judge lighting ≥ 6 | M | RA (lights) + materials (emissive) + board/env (bulb) |
| 4 | The grade replaces lighting: highlight gain 0.74, saturation 0.72, vignette 0.65, grain 0.5 + sharpen; pieces roughened to 0.72 for p95. Result: 47.7% of pixels < 8 (ref 33.8%), missing speculars (p99.9 217.8 against 232.9), grain inflating V2 | Neutral grade, grain 0.15-0.2, vignette 0.4; p95 via EV and light ratios; lacquer pieces (roughness about 0.3-0.4) | V1 in range; pixels < 8 ≤ 38%; median ≥ 12; p99.9 ≥ 225; V2 ≥ 11.5 with grain 0; judge sees piece highlights | S-M | RA (post) + materials (pieces) |
| 5 | No atmosphere: volumetric fog paid for (0.19 ms + 1.65 ms async) but invisible; the room behind the opponent is black (top row 9-16 against 12-26) | Lit beams from window and corridor through denser, lower fog; keep ambient low; less vignette | Top-row grid mean ≥ 15 with visible shafts; pixels < 8 ≤ 38%; judge background row ≥ 6 | M | rendering architect |

## C2 status (2026-10-14, implementation)

Measured on the build PC; evidence in `docs/graphics/iterations/C2-*.jpg` and `C2-lighting.json`, GPU numbers in
PERFORMANCE_BENCHMARKS.md ("C2"). Commits 7499b8d (C2.1), d5014f1 (C2.2, rejected by the lead: white pieces dark from the seat) and C2.3 (Table_Bounce, EV 8.45).

| Defect | State | Evidence |
|---|---|---|
| D1 screen percentage | open (lead): recommendation Epic 83%, High 67%, Medium 58%; never auto | C2.3: native 1440p 17.32 ms (55.7 fps editor offscreen), 75% 11.14 ms, auto 8.42 ms |
| D2 shadowed lights | done: 3 shadowed lights (Lamp_Key, Lamp_Opponent, Window_Cold) | GPU 11.57 → 7.75 ms at auto; Lights + ShadowsDenoiser 6.75 → 2.78 ms (target 2.5 missed by 0.28 ms: Window_Cold must keep its shadow, without it r/g fell to 1.33) |
| D3 lamp as key | partly: Hands_Key and Table_Right removed, key re-aimed at the board centre, a soft Lamp_Bounce from the lamp's side and a low shadowless Table_Bounce from the player's side (the lamp stands beyond the board, so the key alone backlit the white pieces: white median 72.7 → 11.6 in C2.2, 74.8 in C2.3) | C2.3: board 54.3 > right hand 43.3 > left hand 31.0; scalp p95 83.8 < board p95 133.3; white/black piece median ratio 17.8 (≥ 2.5); the shade itself is still out of frame and its emissive dark (board/environment and materials) |
| D4 grade | done: below luma 8 49.5% → 32.3%, median 8.3 → 15.9, grain 0.5 → 0.2, sharpen 1.0 → 0.5 | V1 met (C2.3: 29.1 / 99.7 / 1.473 / 1.661); detail 11.15 (V2 not met) |
| D5 atmosphere | done: fog 0.045, falloff 0.001 | room behind the opponent 9.0 → 17.4, top row 13.7 → 22.7 (C2.3) |
| D6, D8, D9 | not started | |
