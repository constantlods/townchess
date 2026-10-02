# Performance

All numbers on this page were measured on the production machine. No number here is estimated.

## Test machine (audited 2026-10-02)

| Component | Measured |
| --- | --- |
| Host | Proxmox VE, kernel `7.0.14-14-pve`, Debian 13. Bare-metal host, not a VM or LXC |
| CPU | AMD Ryzen 5 5500, 6 cores / 12 threads |
| RAM | 15 GiB. Guests are allocated 13 GiB of it (VM 108 8 GiB, LXCs 110/111/113 5 GiB). About 5 GiB of swap was in use |
| GPU | AMD Radeon RX 6650 XT (XFX), Navi 23, PCI `0000:03:00.0` (`1002:73ef`), 8 GiB VRAM (`mem_info_vram_total` = 8573157376) |
| GPU binding | `amdgpu` on the **host**. No `vfio-pci`, and no VM has a `hostpci` entry |
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

## UE5 benchmark scene

**Not run yet.** Blocked by the items in [RENDERING.md § Blockers](RENDERING.md#blockers-for-unreal-engine-5).

The plan is a scene with a table, board, 32 pieces, hands, an opponent, a lamp and a room. It will be measured at
1080p, 1440p and 4K with TSR and FSR, recording FPS, frame time, 1% lows, GPU and CPU use, VRAM, RAM and
temperature. The results will be added here, in the same tables as the baseline.
