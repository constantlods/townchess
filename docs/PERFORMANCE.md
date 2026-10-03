# Performance

All numbers on this page were measured on the production machine. No number here is estimated.

## Test machine (audited 2026-10-02)

| Component | Measured |
| --- | --- |
| Host | Proxmox VE, kernel `7.0.14-14-pve`, Debian 13. Bare-metal host, not a VM or LXC |
| CPU | AMD Ryzen 5 5500, 6 cores / 12 threads |
| RAM | 15 GiB. Guests are allocated 13 GiB of it (VM 108 8 GiB, LXCs 110/111/113 5 GiB). About 5 GiB of swap was in use |
| GPU | AMD Radeon RX 6650 XT (XFX), Navi 23, PCI `0000:03:00.0` (`1002:73ef`), 8 GiB VRAM (`mem_info_vram_total` = 8573157376) |
| GPU binding | At audit time: `amdgpu` on the host. Since 2026-10-02 it is passed through (`vfio-pci`) to render VM 131 for UE5 |
| OpenGL | radeonsi, OpenGL 4.6 core, Mesa 25.0.7 |
| Vulkan | RADV NAVI23, Vulkan 1.4.305, Mesa 25.0.7 |
| Hardware ray tracing | `VK_KHR_ray_tracing_pipeline`, `rayQuery = true`, `rayTracingPipeline = true` (RDNA2 ray accelerators) |
| Video encode | VA-API: H.264 CB/Main/High and HEVC Main/Main10 `EncSlice`. Vulkan Video: `VK_KHR_video_encode_h264/h265` |
| Storage | `/` has 7.6 GB free (89% used). `smalldrive` NVMe has 232 GB free. `TTB` HDD has 1.79 TB free |
| Network | `vmbr0` 192.168.0.208/24 over `nic0` |

To get the Vulkan and VA-API results above, these userspace packages were installed on the host:
`mesa-vulkan-drivers`, `mesa-va-drivers`, `vulkan-tools`, `mesa-utils`, `vainfo` and `ffmpeg`. Before that, only
the OpenGL side of Mesa was present.

## Hardware H.264 encode (Pixel Streaming prerequisite)

Command: `ffmpeg -vaapi_device /dev/dri/renderD128 -f lavfi -i testsrc2=size=WxH:rate=60 -t 10 -vf format=nv12,hwupload -c:v h264_vaapi -b:v 12M`

| Resolution | 600 frames encoded in | Throughput | Output |
| --- | --- | --- | --- |
| 1920×1080 | 2.73 s | ≈220 fps | H.264 High, 600 frames |
| 2560×1440 | 4.41 s | ≈136 fps | H.264 High, 600 frames |

The wall time includes generating the test pattern on the CPU, so the encoder alone is faster than this.

**Conclusion: AMD hardware H.264 encoding works on this Linux host.**

## Baseline: the existing Three.js renderer on the RX 6650 XT

Tool: `tools/gpubench.mjs`. It runs headless Chromium with ANGLE → Vulkan → RADV. Vsync and the frame-rate limit
are off. The game is on the default **HIGH** quality and the default environment (Institutional Oak). The tool
warms up for 3 s, then samples `requestAnimationFrame` intervals for 10 s.

The WebGL renderer string confirms that the real GPU did the rendering:
`ANGLE (AMD, Vulkan 1.4.305 (AMD Radeon RX 6650 XT (RADV NAVI23)), radv)`.

| Resolution | Avg FPS | Avg frame time | 1% low FPS | Load to ready |
| --- | --- | --- | --- | --- |
| 1920×1080 | 90.8 | 11.0 ms | 25.4 | 4.7 s |
| 2560×1440 | 59.3 / 59.4 (two runs) | 16.9 ms | 17.6 / 17.7 | 4.1 s |
| 3840×2160 | 28.0 | 35.8 ms | 6.3 | 3.8 s |
| 1170×2532 (portrait) | 64.5 | 15.5 ms | 11.1 | 3.8 s |

GPU telemetry sampled from sysfs every 0.5 s during the 1440p, 4K and portrait runs:

| Metric | Value |
| --- | --- |
| GPU busy, peak | 99% |
| GPU busy, average | 80% |
| VRAM used, peak (whole GPU) | 2.59 GB |
| Edge temperature, peak | 72 °C |

Screenshots of these runs are in [`screenshots/gpu-baseline/`](screenshots/gpu-baseline/).

### What the baseline says

- **Average frame rate.** The procedural renderer is GPU-bound: 59 fps at 1440p and 28 fps at 4K. Earlier
  sessions only rendered with SwiftShader, a software renderer, so these are the first real-GPU figures.
- **1% lows.** These are poor: 17–25 fps at 1080p and 1440p. Frame pacing has spikes that the averages hide. This
  should be fixed whatever engine is chosen.
- **Memory use.** VRAM use is low, at 2.6 GB of 8 GB. The browser path is limited by shading cost and by the assets
  themselves, not by memory.
- **Comparing setups.** Earlier screenshots were made with SwiftShader, which does not match what this GPU renders.
  `tools/screenshots.mjs` now uses the GPU by default. Set `SOFTWARE=1` to get the old behaviour.
- **OpenGL backend.** ANGLE's OpenGL backend (`ANGLE=gl`) would not start in headless mode on this host. Vulkan is
  the working path.

## UE5 benchmark scene (Phase 3), 2026-10-03

### Setup

**Render VM.** All runs are in VM 131 `townchess-ue5` on the same host.
- 10 vCPUs and 10 GiB RAM.
- RX 6650 XT passed through with `hostpci0: 0000:03:00,pcie=1`.
- Ubuntu 26.04, kernel 7.0.0-38.
- **Mesa 26.2.3** (from `ppa:kisak/kisak-mesa`). Hardware ray tracing in UE needs it; see
  [RENDERING.md](RENDERING.md).

**Engine.** Unreal Engine 5.8.3 (prebuilt Linux build).
- Vulkan SM6.
- Lumen GI and reflections, Virtual Shadow Maps, Nanite and TSR.
- Hardware ray tracing on unless a run says otherwise.

**Scene.** `ue5/TownChessBench`, rebuilt by `Scripts/build_scene.py`: 115 actors.
- Poly Haven CC0 table and chess set (board plus 32 pieces).
- Lamp, wheelchair, cabinet, desk, pipes, fluorescent fixture, books and binder.
- Template mannequin opponent in an authored seated pose, and template VR hands as the player's hands.
- Warm spot key light, cool rect fill and a rim light.
- Volumetric fog.
- Fixed exposure.

**Method.**
- Tools: `ue5/tools/bench_matrix.sh` → `run_bench.sh` → `Scripts/bench_game.py`.
- Each run is uncooked `-game -RenderOffscreen`.
- The output size is forced with `r.SetRes`, and every run logs its real viewport size.
- Screen percentage is explicit: the internal render size is output × percentage, upscaled by TSR.
- 60 s warm-up, then 1,200 frames recorded with the CSV profiler.
- **1% low** = 1000 / 99th-percentile frame time.
- Telemetry is sampled from the GPU's sysfs every 0.5 s.

### Results

| Output | Preset | Render % (TSR) | Avg FPS | Avg ms | 1% low FPS | GPU ms | VRAM peak | Temp peak | Power avg |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1920×1080 | HIGH | 100 (native) | 57.2 | 17.5 | 52.6 | 16.5 | 3.06 GB | 81 °C | 124 W |
| 1920×1080 | HIGH | 67 | 94.5 | 10.6 | 83.8 | 9.5 | 2.94 GB | 81 °C | 121 W |
| 2560×1440 | HIGH | 100 (native) | 34.9 | 28.7 | 33.5 | 27.6 | 3.45 GB | 82 °C | 127 W |
| 2560×1440 | HIGH | 75 | 55.2 | 18.1 | 50.5 | 17.1 | 3.54 GB | 82 °C | 124 W |
| **2560×1440** | **HIGH** | **67** | **64.5** | **15.5** | **59.6** | **14.5** | **3.07 GB** | 82 °C | 123 W |
| 2560×1440 | HIGH | 50 | 90.6 | 11.0 | 80.1 | 10.0 | 3.41 GB | 81 °C | 122 W |
| 2560×1440 | HIGH, **software Lumen** | 67 | 67.4 | 14.8 | 62.2 | 13.9 | 5.26 GB | 82 °C | 124 W |
| 2560×1440 | LOW | 67 | 182.1 | 5.5 | 158.2 | 4.8 | 2.63 GB | 82 °C | 121 W |
| 2560×1440 | MEDIUM | 67 | 99.7 | 10.0 | 88.1 | 9.2 | 2.45 GB | 81 °C | 121 W |
| 2560×1440 | ULTRA (UE "Epic") | 67 | 38.1 | 26.2 | 35.8 | 25.3 | 4.40 GB | 82 °C | 124 W |
| 2560×1440 | CINEMATIC | 67 | 16.0 | 62.4 | 15.6 | 61.5 | 6.76 GB | 82 °C | 127 W |
| 3840×2160 | HIGH | 100 (native) | 16.8 | 59.4 | 16.5 | 58.3 | 4.72 GB | 82 °C | 129 W |
| 3840×2160 | HIGH | 50 | 51.1 | 19.6 | 48.1 | 18.6 | 4.68 GB | 82 °C | 124 W |
| 3840×2160 | HIGH | 33 | 80.4 | 12.4 | 72.4 | 11.4 | 3.42 GB | 82 °C | 124 W |
| 1170×2532 (portrait) | HIGH | 67 | 125.3 | 8.0 | 96.7 | 6.2 | 2.93 GB | 79 °C | 88 W |

Throughout these runs:
- The game thread stayed at 2.5–2.8 ms and the render thread at about 6.3 ms.
- The GPU was 92–98% busy.
- The VM never had less than 6.4 GB of RAM available.

Every configuration is **GPU-bound**. Screenshots are in
[`screenshots/ue5-bench/`](screenshots/ue5-bench/), named `<output>-<preset>-sp<render %>`.

### What this says

- **UE5 is viable on the RX 6650 XT at the 1440p target with TSR.** 1440p HIGH at 67% render scale gives
  64.5 fps average, 59.6 fps 1% low and 3.1 GB VRAM. At 50% it gives 90.6 fps. Frame pacing is tight: the 1% lows
  are within 10% of the averages, compared with the browser renderer's 17 fps lows at 59 fps.
- **Native 1440p and 4K are not realistic** (35 fps and 17 fps). Temporal reconstruction is the plan, not a
  fallback.
- **Hardware ray tracing does not pay for itself here.**
  - Software Lumen was 4% faster (67.4 against 64.5 fps).
  - In this scene it was visually indistinguishable at normal viewing size.
  - It peaked higher in VRAM (5.3 GB), probably from building both the software and hardware ray-tracing structures.
    This is worth checking with a fully software-only setup (`r.RayTracing 0` at startup).
  - Hardware ray tracing should be judged again for reflections on the metal mask, which this scene doesn't
    have yet.
- **CINEMATIC is not a realtime preset on this card.** It runs at 16 fps with 6.8 GB VRAM, near the 8 GB limit. It is
  only useful for offline captures.
- **ULTRA costs 1.7× HIGH** for little visible difference in this scene.
- **Portrait isn't comparable yet.** The 125 fps is real, but the camera keeps its horizontal field of view, so a
  tall frame adds a large dark ceiling and an unlit area under the table that are cheap to render. Portrait needs its
  own camera framing before its numbers mean anything.

### Caveats

- **Placeholder assets.** The opponent and hands are template mannequins. MetaHuman-grade skin, hair and cloth will
  cost GPU time, so budget on the order of 2–4 ms for the character. That is an estimate, to be measured in
  Phase 9.
- **Uncooked runs.** These are uncooked editor-binary `-game` runs. A cooked Shipping build mainly changes CPU-side
  overhead, which isn't the limit here.
- **Screenshots.** They come from a SceneCapture at the player's view, because `HighResShot` writes nothing under
  `-RenderOffscreen`. Their tone and exposure match the game view's post-process volume.
- **Discarded results.**
  - An earlier matrix rendered **every run at 1280×720**, because GameUserSettings overrode `-ResX`/`-ResY` offscreen.
    That made 1080p, 1440p and 4K look identical at about 122 fps.
  - An even earlier run measured an empty level (169 fps), caused by a level-save bug.
  - Both were discarded. The invalid run directories are kept in the VM under `~/bench-results/invalid-720p/`.
