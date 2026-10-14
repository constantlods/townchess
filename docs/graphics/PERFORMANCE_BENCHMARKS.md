# Performance benchmarks (graphics division)

Owner: rendering architect. Every number here was measured; estimates are labelled as estimates. Raw CSV profiles,
logs and smoke results stay on the build PC under `C:\TownChess\work\ra\` (not committed: 2-4 MB each).

## Test setup (2026-10-13)

| | |
|---|---|
| PC | Windows 11 25H2 (10.0.26200), AMD Ryzen 9 7900X, 31 GB RAM |
| GPU | NVIDIA GeForce RTX 4070 Ti SUPER 16 GB, driver 616.64 (`nvidia-smi`; UE log "Chosen D3D12 Adapter Id = 0", the iGPU is not used) |
| Display | 2560x1440 at 299 Hz (desktop resolution of the RTX output) |
| Engine | UE 5.8.3-58210709, D3D12 SM6, ray tracing "enabled (dynamic)" |
| Build | packaged Development build `C:\TownChess\builds\Development\Windows`, written 2026-10-06 15:45 (content of `ad640d1`/`7cb3a50`; the build PC checkout is at `7cb3a50`) |
| Profiling | editor `-game` (same checkout) for `ProfileGPU` |

Method:
- Each run is one packaged smoke game (`-tcsmoke=400`, the game plays itself to checkmate), `-RenderOffscreen`,
  `r.SetRes 2560x1440w`, plus `-ExecCmds` with `r.GPUCsvStatsEnabled 1`, `csvprofile frames=6000` and the cvar
  queries listed in RENDERER_AUDIT.md.
- Statistics use the CSV profiler's frames after the first 10 s. 1% low = 1000 / 99th-percentile frame time.
  The game's own `smoke.json` figures (same 10 s cut) agree with the CSV to within 0.5 fps in every run.
- VRAM, power and utilisation come from `nvidia-smi` sampled every 0.5 s. The first three runs logged nothing
  because of a file-flush problem, which was fixed for the later runs.
- Script: `ra_runs.ps1` / `ra_runs2.ps1` in `C:\TownChess\work\ra\`. Lock held as `rendering-architect` from
  20:23 to 20:36 (13 min).

**Limits of these numbers:**
- Smoke games end at checkmate, so the measured windows are short (3-46 s). Treat differences under about 8% as noise.
  For example, `auto` and `auto2` are the same configuration and gave 84.8 and 78.8 fps.
- Everything is offscreen, so there is no swapchain present or vsync cost. A presented run from the SSH session is
  impossible: the game dies with `DXGI_ERROR_NOT_CURRENTLY_AVAILABLE` creating the swapchain (session 0 has no display;
  `run-presented.log`). BETA S3 still needs one run in the owner's interactive session.

## Results: 2560x1440 output, default view, RTX 4070 Ti SUPER

"auto" is what the owner gets. It is `ApplyQualityPreset` → epic: sg.* 3, hardware Lumen, Lumen HW reflections,
RT shadows, and the engine's automatic screen percentage. The real internal resolution is **1552x873 (60.6%)**,
read from ProfileGPU's TSR pass: `TemporalSuperResolution 1552x873 -> 2560x1440`.

| Run | Preset / overrides | Internal res | Avg fps | 1% low | p50 ms | GPU ms | Render thr ms | Game thr ms | VRAM peak | Window |
|---|---|---|---|---|---|---|---|---|---|---|
| auto | epic + HW RT (default) | 60.6% auto | **84.8** | **69.3** | 11.66 | 11.32 | 11.79 | 1.28 | - | 9.9 s |
| auto2 | same (repeat) | 60.6% auto | 78.8 | 70.2 | 12.87 | 12.18 | 12.69 | 1.33 | 5.6 GB | 8.3 s |
| sp75 | + `r.ScreenPercentage 75` | 1920x1080 | 62.9 | 56.1 | 15.85 | 15.44 | 15.89 | 1.26 | 5.7 GB | 39.4 s |
| sp100 | + `r.ScreenPercentage 100` | native | 37.9 | 31.8 | 25.68 | 25.87 | 26.36 | 1.46 | 6.5 GB | 21.7 s |
| rtsoff | + `r.RayTracing.Shadows 0` (VSM) | 60.6% auto | 84.1 | 57.9* | 11.31 | 11.45 | 11.89 | 1.35 | 6.3 GB | 42.7 s |
| rtsoff75 | VSM + SP 75 | 1920x1080 | 66.7 | 60.9 | 14.94 | 14.56 | 14.99 | 1.32 | 6.4 GB | 7.0 s |
| rtsoff100 | VSM + SP 100 | native | 42.2 | 33.9 | 23.00 | 23.24 | 23.71 | 1.48 | 6.8 GB | 46.3 s |
| high | `-tcquality=high`: sg 2, software Lumen, VSM | 60.6% auto | 127.1 | 106.7 | 7.82 | 7.49 | 7.87 | 1.34 | - | 3.3 s |
| high2 | same (repeat) | 60.6% auto | 117.1 | 98.5 | 8.53 | 8.10 | 8.54 | 1.39 | 5.4 GB | 19.5 s |
| medium | `-tcquality=medium` | 60.6% auto | 166.2 | 137.9 | 6.00 | 5.66 | 6.02 | 1.20 | 4.9 GB | 13.7 s |

\* One 113.7 ms hitch (0.08% of frames over 2x the median) in `rtsoff`. It is most likely a pipeline compile after
switching the shadow method: the build ships no PSO cache (`Could not open FPipelineCacheFile ... stable.upipelinecache`,
69-77 "PSOPrecacheState: Missed" lines per start). On this PC they all fall in the first 7 frames because the driver's
shader cache is warm. A first launch on another PC would hitch more.

Baseline for comparison (GRAPHICS_AGENT_STATUS, same build, auto): 86.9 avg / 72.1 1% low offscreen. Today's auto
runs (84.8/69.3 and 78.8/70.2) reproduce it within run-to-run noise.

Across all runs the GPU was busy 95-99% and drew 244-282 W on average while busy. The render thread time equals
GPU time + about 0.5 ms (it waits on the GPU), and the game thread is 1.2-1.5 ms. **Every configuration is GPU-bound.**
CPU and frame pacing are not the limit offscreen: no frame exceeded 2x the median except the hitch above.

## Where the GPU time goes (auto, 1552x873 → 2560x1440)

CSV GPU stats cover the graphics queue only (sum ≈ GPUTime). Run `auto`, mean ms per frame:

| Pass | ms | Share |
|---|---|---|
| ShadowsDenoiser (RT shadow denoise) | 3.53 | 31% |
| Lights (RT shadow rays + light shading) | 2.92 | 26% |
| TemporalSuperResolution (history at 200%) | 1.09 | 10% |
| Unaccounted | 0.55 | 5% |
| LumenReflections | 0.35 | 3% |
| Nanite VisBuffer + BasePass | 0.57 | 5% |
| DepthOfField | 0.21 | 2% |
| VolumetricFog | 0.19 | 2% |
| SubsurfaceScattering | 0.18 | 2% |
| everything else | ~1.7 | 15% |

ProfileGPU (editor `-game`, frame 3506, same settings) gives the per-light breakdown of the 6.27 ms `Lights` node.
Shadowed lights are batched four at a time through one denoiser:
- Batch 1, 2.27 ms: Rim 0.56 ms of rays, Table_Right 0.17, Lamp_Key 0.105, Lamp_Opponent 0.001, plus the denoiser 1.35.
- Batch 2, 2.71 ms: Window_Cold 0.46, Corridor_Glow 0.47, Fluorescent_Fill 0.40, Hands_Key 0.18, plus the denoiser 1.11.
- Batch 3, 0.72 ms: BackWall_Wash 0.25 plus the denoiser 0.41.
- Lamp_Bulb has no shadow and costs 0.02 ms.

**The hero light (Lamp_Key) costs 0.1 ms. The six fill/rim lights cost about 5 ms.**

At native resolution the same node costs 17.4 ms, which is 68% of a 25.5 ms frame.

On the async compute queue, which overlaps the graphics queue, the same frame runs Lumen DiffuseIndirectAndAO for
6.06 ms: ScreenProbeGather 4.41 ms, of which HW ray tracing is 1.15 ms, and TranslucencyVolumeLighting 1.65 ms. It is
hidden behind the lighting work today. Once the lighting cost drops, it becomes the next floor.

VSM instead of RT shadows (`rtsoff`) costs the same: Lights 4.24 ms + ShadowDepths 2.01 ms = 6.25 ms against
6.45 ms. Two 2560x1440 captures of the main view that differ only in `r.RayTracing.Shadows` (scene captures, preset
high) differ by a mean of 2.0/255 per pixel and have identical mean, p95 and detail. So **the shadow method changes
neither the cost nor the look of this view. The cost is the number of shadowed lights.**

## C2 (2026-10-14): lighting changes measured one at a time

Method: for each change the level is rebuilt (`setup_content.ps1`), the benchmark seat cameras are captured
(`capture.ps1 -Preset epic`, the shots of `benchmark.ps1`) and the editor `-game` (default preset → epic + HW RT, auto
screen percentage) records a CSV profile of 570 frames at 2560x1440 (`r.SetRes 2560x1440w`, `r.GPUCsvStatsEnabled 1`,
after 30 s warm-up). Scripts `ra_iter.ps1` / `ra_gpu.py` in `C:\TownChess\work\ra\`. The editor runs offscreen like
the packaged runs; its numbers are compared with each other, the packaged run at the end is in the table below.

| Step | GPU ms | Lights + ShadowsDenoiser ms | Avg fps (editor) | Image (main view) |
|---|---|---|---|---|
| c1: C1 state (10 shadowed lights) | 11.57 | 3.06 + 3.69 = 6.75 | 82.8 | mean 23.0, p95 98.2, r/g 1.447, g/b 1.643, below 8: 49.5% |
| s1: shadows only on Lamp_Key + Lamp_Opponent | 7.96 | 1.12 + 0.64 = 1.76 | 117.9 | **rejected**: Window_Cold (2500 lm, 7500 K, facing the camera from the back wall) then lit the board and hands through the opponent: r/g 1.33, g/b 1.45, p95 108.7 (V1 fails) |
| s1b: + Window_Cold keeps its shadow | **7.75** | 1.36 + 1.42 = **2.78** | **122.1** | kept: mean 24.0, p95 95.6, r/g 1.414, g/b 1.591, below 8: 45.3%; same look, piece shadows unchanged |

**Shadows on 3 lights instead of 10 save 3.8 ms of GPU time (11.57 → 7.75 ms, -33%) at the auto 60.6% screen
percentage.** The D2 target (Lights + ShadowsDenoiser ≤ 2.5 ms) is missed by 0.28 ms because Window_Cold keeps a shadow;
without it the image fails V1.

Then the lighting hierarchy and grade (C2.2, details in VISUAL_REBUILD_ROADMAP.md): Hands_Key and Table_Right removed,
one unshadowed Lamp_Bounce from the lamp's side, fog 0.035 → 0.045, new grade. Same probe, plus 400 frames at
`r.ScreenPercentage 75` and 300 at 100 in the same session:

| C2.2 state | GPU ms | Lights + ShadowsDenoiser | VolumetricFog | TSR | Avg fps (editor) | 1% low |
|---|---|---|---|---|---|---|
| auto (60.6%, 1552x873) | 8.13 | 1.41 + 1.52 | 0.20 | 1.14 | 116.6 | 102.5 |
| 75% (1920x1080) | 10.66 | 2.10 + 2.34 | 0.30 | 1.33 | 89.4 | 79.9 |
| 100% (native 2560x1440) | 16.63 | 3.82 + 4.10 | 0.56 | 1.78 | 58.0 | 53.5 |

C2.3 (Table_Bounce added, EV 8.45; the state that ships), same probe:

| C2.3 state | GPU ms | Lights + ShadowsDenoiser | VolumetricFog | TSR | Avg fps (editor) | 1% low |
|---|---|---|---|---|---|---|
| auto (60.6%) | 8.42 | 1.54 + 1.51 | 0.22 | 1.19 | 112.0 | 96.1 |
| 75% | 11.14 | 2.23 + 2.43 | 0.31 | 1.39 | 85.7 | 76.7 |
| 100% | 17.32 | 4.01 + 4.26 | 0.58 | 1.83 | 55.7 | 51.1 |

Against C1 (11.57 ms) C2.3 saves 3.15 ms at auto (-27%). **Packaged** (f140362, `package.ps1` + `beta_checks.ps1 -Games 0`, 2560x1440 auto,
offscreen, a 54-ply smoke game to checkmate): **116.1 fps average, 96.3 fps 1% low**, against 86.9 / 72.1 at the
baseline (+34% average). V2 with grain 0 (same build, `TC_GRAIN=0`): detail 11.06 against 11.17 at grain 0.2, so the
grain now adds about 0.1 to the metric. Native 1440p went from 25.9 ms (Phase A, 10 shadowed lights) to 16.6 ms. The fog and bounce cost about 0.4 ms over
s1b, which is inside run-to-run noise for the total.

**Screen percentage per tier (recommendation to the lead for `ApplyQualityPreset`):**
- Epic (RTX 4070 Ti SUPER, 1440p): **83%** (2125x1195). Interpolating the measured C2.3 75% (11.1 ms) and 100% (17.3 ms),
  83% costs about 13 ms (estimate): about 75 fps offscreen, leaving margin for present cost and the 1% low (≥ 45).
  100% measured 55.7 fps offscreen (C2.3), under the 60 fps average target once present cost is added.
- High: 67% (unchanged from the RX 6650 XT measurement in PERFORMANCE.md).
- Medium: 58%.
- Never leave it at auto: at 1440p on this display auto gives 60.6%, the soft frame the owner complained about.

## RX 6650 XT

Nothing was measured on the RX 6650 XT for the current scene. VM 131 is stopped and must not be started without the
lead's approval. The last real numbers on that card are from the October 3 benchmark scene (PERFORMANCE.md: 1440p HIGH
at 67%, 64.5 fps, 3.1 GB). That scene had no MetaHumans and fewer lights, so it is not comparable.

**Estimate, not a measurement:** the RTX 4070 Ti SUPER is about 2.3-2.5x an RX 6650 XT in raster. Scaling `high2`
(8.1 ms GPU at 60.6%) gives roughly 19-20 ms, about 50 fps, at 1440p High today. After the light-count fix in
RENDERER_AUDIT.md it would be about 60 fps. VRAM at High was 5.4 GB on NVIDIA, inside 8 GB with little margin for 8K
MetaHuman virtual textures.
