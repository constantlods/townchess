# Rendering — engine evaluation (Phase 2)

Status 2026-10-02: the evaluation is done and the decision is made. The UE5 benchmark is **blocked on two things
only the owner can provide** (see below). No game code has been migrated yet. Following the spec, that waits until
the benchmark has run.

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
| Runs on this host today | **Yes, measured: 59 fps at 1440p HIGH** | Yes (Vulkan works) | Not yet. See blockers |
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
- TSR is UE5's own upscaler and is vendor-neutral. It is the default temporal reconstruction here. **No DLSS.** AMD's
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

## Blockers for Unreal Engine 5

1. **Epic account / EULA.**
   - Prebuilt Linux UE5 binaries can only be downloaded after logging into an Epic account.
   - Engine source needs the GitHub account linked to Epic. Today `gh api repos/EpicGames/UnrealEngine` returns 404
     for `constantlods`, so the account is not linked.
   - Only the owner can accept the EULA.
2. **RAM.**
   - The UE5 editor with Lumen and Nanite shader compilation needs about 16 GB just for itself, and 32 GB is
     recommended.
   - The host has 15 GiB in total, with 13 GiB allocated to guests and swap already in use.
   - Running the editor next to VM 108 (8 GiB) would make the host swap heavily, or trigger the OOM killer.
   - Options:
     - Stop or shrink VM 108 while working in UE.
     - Add RAM (the B550/A520 platform takes up to 128 GB).
     - Author content on another machine and only run packaged builds here.
3. **Disk.**
   - `/` has only 7.6 GB free.
   - UE should go on `smalldrive` (NVMe, 232 GB free), not on the root filesystem and not on the HDD.

## Where UE5 would run (Proxmox architecture)

The GPU is currently bound to `amdgpu` **on the host**, and no VM has it passed through. That leaves two options:

- **Option 1: run UE5 and Pixel Streaming directly on the host.**
  - It is the simplest option, needs no vfio changes, and the GPU and encoder are already proven to work.
  - The cost is running a heavy graphics workload in the hypervisor's own OS.
- **Option 2: run a dedicated VM with `hostpci0: 0000:03:00,pcie=1`.**
  - This is the spec's preferred layout.
  - VM 130 (Bazzite) used exactly this before it was removed, so passthrough is known to work on this board.
  - The GPU is then unavailable to the host, and the VM needs its own large RAM allocation, which runs into
    blocker 2.

A Windows VM would only be justified if Linux Pixel Streaming encoding fails on AMD. Whether Linux Pixel
Streaming can drive AMD encoding (through VA-API, AMF or Vulkan Video, depending on the UE version) is **not yet
verified**. It is the first thing to test after the benchmark scene renders.

## Separation of game logic and rendering

This holds whatever engine is chosen. `packages/shared` (rules, clock, protocol) and `packages/server` (authority,
matchmaking, reconnect, Elo) do not depend on rendering. A UE5 client would be one more protocol client, using the
same JSON WebSocket messages that the browser's `NetClient` uses today.
