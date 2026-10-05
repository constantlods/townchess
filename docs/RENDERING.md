# Rendering — engine evaluation (Phase 2)

Status 2026-10-03:
- **The UE5 benchmark has run on the RX 6650 XT.** UE5 is viable at 1440p with TSR. See
  [PERFORMANCE.md § UE5 benchmark scene](PERFORMANCE.md#ue5-benchmark-scene-phase-3-2026-10-03).
- The blockers below are resolved.
- No game code has been migrated yet. Gameplay integration (Phase 14) and the streaming decision come next.

## Hardware facts this is based on

All of these were measured; see [PERFORMANCE.md](PERFORMANCE.md).

- **GPU.** RX 6650 XT, RDNA2 (Navi 23), 8 GB VRAM. It is driven by `amdgpu` on the Proxmox host itself, and RADV
  Vulkan 1.4 reports hardware ray tracing.
- **Video encode.** The VA-API H.264 and HEVC encoders work, at about 220 fps for 1080p.
- **Memory.** 15 GiB of RAM in total, of which 13 GiB is already allocated to running guests. **This is the binding
  constraint**, more than the GPU.
- **CPU.** 6 cores and 12 threads (Ryzen 5 5500).

## Candidates

| | A/B: Three.js (WebGL2, or WebGPU) | C: Godot 4 | D: Unreal Engine 5 |
| --- | --- | --- | --- |
| Global illumination | Baked or probe-based only | SDFGI / VoxelGI (real-time, coarse) | Lumen (software or hardware RT) |
| Shadows | Shadow maps, PCF/VSM | Shadow maps + contact shadows | Virtual Shadow Maps + contact shadows |
| Geometry | Manual LODs | Manual LODs | Nanite (scanned meshes at full detail) |
| Skin | Approximate (no true screen-space SSS in stock three) | Screen-space SSS | Substrate/subsurface profile skin, MetaHuman-grade |
| Hands and character rigs | Hand-written IK (exists today, 17 bones) | IK, but small ecosystem | Control Rig, Full-Body IK, MetaHuman hands |
| Upscaling on AMD | None built in | FSR 2 built in | TSR built in (vendor-neutral); AMD FSR plugin |
| Delivery to players | Native browser; everyone renders locally | Native, or web export (weaker) | Pixel Streaming: server renders and streams video |
| Runs on this hardware | **Yes, measured: 59 fps at 1440p HIGH** | Yes (Vulkan works) | **Yes, measured: 64.5 fps at 1440p HIGH with TSR at 67%** |
| Editor cost | None | ~150 MB, light | Editor ~60–100 GB on disk; **32 GB RAM recommended** |

### Assessment

**A/B: the current browser renderer.**

- It is measured and works on this GPU, but it is not the right tool for this target. There is no real-time global
  illumination, no proper skin subsurface scattering, and no high-polygon character pipeline.
- WebGPU would make it faster, not more realistic: the techniques that make the reference images look photographed
  (GI, virtual shadows, scanned geometry) are not available.
- It does have one unique strength: every player renders locally, so the server's single GPU never limits how many
  people can play.

**C: Godot 4.**

- It is a real step up from the browser renderer (SDFGI, volumetric fog, SSS, FSR 2) and is light enough for this
  host as it is now.
- Its GI is coarse at tabletop scale, and its character and IK tools are far behind UE5.
- It is the fallback if UE5 turns out not to fit on this host.

**D: Unreal Engine 5.**

- It is the only candidate whose renderer matches the target: Lumen, Nanite, VSM, Substrate skin, Control Rig and
  Full-Body IK, Niagara and Pixel Streaming.
- RDNA2 ray tracing is present, so hardware Lumen can be tested rather than assumed.
- TSR is UE5's own upscaler and is vendor-neutral. It is the default temporal reconstruction here. **No DLSS yet (tracked: NVIDIA's free DLSS plugin for UE 5.8 needs the owner's Fab download; then it is enabled for the RTX preset).** AMD's
  FSR plugin for UE5 will only be used if it measurably beats TSR on this card.

**Decision: UE5 stays the primary candidate.** The next step is the small benchmark scene, not a migration.

## The real bottleneck: assets, not the engine

Whatever the engine, photorealism comes from scanned or professionally sculpted assets. The procedural SDF meshes
look the way they do because they are procedural.

The assets have to be original and legally clean. Usable sources:

- **MetaHuman.** Hands, arms and the opponent's body. Free, but it requires an Epic account and is licensed for
  use in Unreal Engine only.
- **Quixel Megascans via Fab.** Scanned wood, plaster, metal, paper and props. Free in UE through an Epic account.
- **Poly Haven.** CC0 textures and HDRIs that can be used in any engine.
- **Original sculpts.** The chess pieces, the board and the mask. These are a small number of hero assets and
  should be modelled as originals.

So the Epic account is also what unlocks the asset quality, not just the engine.

## Blockers for Unreal Engine 5 (resolved 2026-10-02/03)

1. **Epic account.**
   - The owner linked their Epic account to GitHub; membership in the EpicGames organization is active.
   - They downloaded the UE 5.8.3 Linux zip themselves.
   - The zip is archived at `TTB:/ue5-archive/`.
2. **RAM.**
   - VM 108 is stopped while UE work runs. It had only ever been sitting at an installer screen.
   - The render VM gets 10 GiB plus a 16 GiB swap file of its own.
   - amdgpu's TTM page pool is capped at 1 GiB in the VM, because it had been holding about 4.8 GB.
   - Benchmark runs never dropped below 6.4 GB of available memory.
3. **Disk.** The engine (73 GB) and project live on the VM's 200 GB disk on the `smalldrive` NVMe.

## What was learned on this hardware

- **Hardware ray tracing on RADV needs a newer Mesa than Ubuntu 26.04 ships.**
  - With Mesa 26.0.8, UE 5.8 logs "driver does not support acceleration structures in the mutable descriptor set"
    and disables ray tracing entirely.
  - Mesa 26.2.3 from `ppa:kisak/kisak-mesa` fixes it: "Ray tracing is enabled".
  - Any deployment has to pin a Mesa at least that new.
- **Hardware Lumen is not worth it in this scene.** Software Lumen was 4% faster and looked the same. The default plan
  is software Lumen plus Virtual Shadow Maps. Hardware ray tracing gets another look once there are glossy metal
  surfaces (the mask) whose reflections it could improve.
- **TSR is the temporal reconstruction.** It is vendor-neutral and built into UE5. 1440p output from 67% internal
  resolution (about 1715×965) gives roughly 65 fps. AMD FSR has not been evaluated in UE yet: AMD's UE plugin would
  have to support Linux/Vulkan, and that needs checking. **No DLSS yet (tracked: NVIDIA's free DLSS plugin for UE 5.8 needs the owner's Fab download; then it is enabled for the RTX preset).**
- **Proxmox layout.** UE runs in a dedicated VM (131) with the GPU passed through, not on the host. The host then
  can't use the GPU while the VM is running.

## Pixel Streaming on Linux + AMD: an engine limitation

These facts come from UE 5.8.3's plugin files:
- **Hardware encoders on Linux.** PixelStreaming2 uses the AVCodecs plugins. On Linux the only hardware encoder
  binaries are `NVCodecs`/`NVENC`, which are NVIDIA-only.
- **AMD's encoder plugin.** `AMFCodecs` lists `SupportedTargetPlatforms: ["Win64"]` and ships no Linux binaries.
- **Software fallback.** `LibVpxCodecs` (VP8/VP9 on the CPU) is available on Linux.

The GPU's own H.264 and HEVC encoder works on Linux through VA-API: about 220 fps at 1080p, measured with ffmpeg.
UE's Pixel Streaming just can't use it.

| Option | What it means | Cost |
| --- | --- | --- |
| A. Linux + PixelStreaming2 with VP8/VP9 software encoding | Simplest, stays in UE | CPU encode on a 6-core host that also runs the game thread and render thread. Needs measuring |
| B. Windows render VM + PixelStreaming2 with AMF H.264 | The supported AMD path | A Windows licence/VM; the same passthrough GPU |
| C. Linux, UE renders → external capture → VA-API H.264 → WebRTC (for example GStreamer `webrtcbin`) | Keeps Linux and the hardware encoder | Custom streaming layer; input has to be forwarded back into UE |
| D. No streaming: players run a packaged client locally | No server GPU limit on player count | Players need their own capable GPU |

**Recommendation:** measure option A first, since it costs only a test. If the CPU cost or latency is unacceptable,
choose between B and C. This needs the owner's input, because it affects licensing and how many people can play at
once. The server's single GPU can render roughly one 1440p session at a time.

## Separation of game logic and rendering

This holds whatever engine is chosen. `packages/shared` (rules, clock, protocol) and `packages/server` (authority,
matchmaking, reconnect, Elo) do not depend on rendering. A UE5 client would be one more protocol client, using the
same JSON WebSocket messages that the browser's `NetClient` uses today.
