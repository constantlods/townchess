# Session Summary — 2026-10-02

A record of the Claude Code session that built Horror Chess.

## The request

The user supplied a detailed build specification for an original, first-person horror chess game. It asked for:

- A single-player visual prototype first, matched against a concept image.
- Online multiplayer second, with an authoritative server.

Midway through, the user added three things:

- The concept image itself.
- A request for the graphics to look as realistic as possible.
- The townchess repository as the game's home.

## How the session went

1. **Setup.** The repository first named, "creepy chess", could not be reached. Work started on a separate branch of
   another repository, then moved here once the user shared townchess. That other repository was restored to its
   original state.
2. **Camera.** The camera was solved numerically against the concept image. The spec's 8–14° downward angle could
   not fit the board, hands and opponent at once, so about 19° was used.
3. **Scene.** Built in the order the spec asked for:
   - environment, table, board and pieces;
   - procedural hands with an IK skeleton, then the masked opponent;
   - lighting and post-processing.

   Headless screenshots were compared with the reference after each step.
4. **Performance.** Asset generation took about 50 seconds at first. Three changes brought it down:
   - faster noise and a smarter mesher;
   - parallel Web Workers;
   - an IndexedDB cache.
5. **Gameplay and interface.** Sessions, the AI engine, the presenter, the hand choreography, the HUD, the lobby, the
   customization and environment screens, settings and audio.
6. **Multiplayer.** Authoritative server, network client, 17 automated tests, and a two-browser end-to-end test.
7. **Visual passes.** Fixes for the grasp angle, the lamp, the opponent's framing, skin detail, board grime, the
   game-over sequence, and the phone and tablet layouts.

## Commits on this repository

| Commit | Content |
| --- | --- |
| e05189a | Visual prototype scaffold |
| a68aec9 | Playable build against the AI, plus UI, audio and server |
| 5f3fad4 | Tests, end-to-end script, README |
| 710978e | Game-over polish, portrait layout, environment thumbnails |
| 1bc8013 | Visual pass and build-scoped asset cache |
| this commit | Report, session summary, screenshots and concept reference |

## Where things stand

- Everything in the spec's first-implementation list works, and multiplayer works.
- See [REPORT.md](REPORT.md) for verification, decisions, remaining work and limitations.
- The main open item is realism: the procedural hands and opponent are convincing in composition and lighting, but
  not photographic.

---

# Session Summary — 2026-10-02 (photorealistic rendering phase, part 1)

The user supplied the "photorealistic horror chess" specification. It targets the AMD RX 6650 XT in the Proxmox
server, with UE5 as the primary candidate engine and a benchmark required before any migration.

## What was done

1. **Phase 0: repository audit.**
   - Read the docs and package scripts, and confirmed a clean baseline.
   - Typecheck is clean, and 17/17 tests pass.
2. **Phase 1: hardware audit.**
   - The GPU is on the host under `amdgpu`, and no VM passes it through.
   - Installed Mesa's RADV Vulkan and VA-API drivers and the diagnostic tools.
   - Verified Vulkan 1.4 with hardware ray tracing.
   - Verified working VA-API H.264 and HEVC hardware encoding, with measured throughput.
3. **Baseline benchmark.**
   - Added `tools/gpubench.mjs`.
   - The existing renderer was measured on the real GPU for the first time, at 1080p, 1440p, 4K and 1170×2532 portrait.
   - Earlier sessions only used SwiftShader.
   - `tools/screenshots.mjs` now uses the GPU by default.
4. **Phase 2: engine evaluation.**
   - UE5 stays the primary candidate.
   - It is blocked by an Epic account/EULA, which only the owner can provide, and by host RAM: 15 GiB total, 13 GiB
     allocated to guests.
   - Documented in RENDERING.md and PERFORMANCE.md.

## Not done (and why)

- **UE5 benchmark scene and later phases.** These need the blockers above resolved. No game code was changed, so
  nothing that works today was put at risk.

---

# Session Summary — 2026-10-02/03 (photorealistic rendering phase, part 2)

## What was done

1. **Engine access.** The owner linked Epic to GitHub and downloaded UE 5.8.3 for Linux. The zip is archived on the
   `TTB` HDD.
2. **Render VM.** At the owner's request, UE runs in its own VM instead of on the hypervisor.
   - VM 131 `townchess-ue5`: Ubuntu 26.04 cloud image, 10 vCPUs, 10 GiB RAM, a 200 GB disk on NVMe, and the RX 6650
     XT passed through.
   - VM 108 (an unused installer) is stopped.
3. **Benchmark project.** `ue5/TownChessBench` with reproducible, scripted content.
   - Scene: CC0 Poly Haven assets, a seated opponent with an authored pose, and the template hands.
   - Runner: an in-game Python benchmark driver.
   - Supporting tools: telemetry, a matrix runner and a summarizer.
4. **Results.** UE5 is viable at 1440p with TSR. The full matrix is in PERFORMANCE.md.

## Problems hit (all fixed, and recorded in the docs)

- **Ray tracing.** Hardware ray tracing was disabled under Mesa 26.0.8. Fixed with Mesa 26.2.3 from the kisak PPA.
- **Disk.** The NVMe filled while the zip existed both unpacked and inside the VM. The VM paused, the host copy was
  removed, and the VM resumed with no data loss.
- **Leftover editor.** A lingering editor process plus amdgpu's TTM page pool pushed the VM into heavy swapping.
  The build wrapper now kills the editor, and the pool is capped.
- **Two sets of invalid numbers, found and discarded before reporting:**
  - an empty level saved by a level-load bug (169 fps);
  - a whole matrix that silently rendered at 720p (about 122 fps "at every resolution").

## Open decisions for the owner

- **Streaming.** UE's Pixel Streaming has no AMD hardware encoder on Linux. Choose among options A–D in RENDERING.md.
- **Assets.** MetaHuman and Megascans need a one-time Epic/Fab sign-in inside the editor, through a remote desktop
  on the VM.
- **Host firewall.** The Proxmox cluster firewall re-enables `bridge-nf-call-iptables`, which breaks networking for
  firewalled VMs on vmbr0. This is a host networking change, left for the owner.

---

# Session Summary — 2026-10-03 (master directive: audit, roadmap, Milestone 1)

The owner supplied a master development directive. They asked for a full audit, a self-chosen roadmap and
implementation of the first milestone. Midway, they asked for helper agents (rules, character design, and especially a
critique agent) and for a GitHub agent to keep the repo updated.

## What was done

1. **Audit.**
   - Strengths: the rules wrapper, the server authority and the `Session` seam.
   - Duplication: game flow written twice, in `GameRoom` and `LocalSession`.
   - Correctness gaps:
     - FIDE 6.9 timeouts were wrong;
     - fivefold and 75-move were missing;
     - promotion silently became a queen;
     - repetition relied on chess.js's flawed en passant hash.
   - Missing: everything about a UE5 client.
2. **Roadmap**, revised after the critique agent's review. See ROADMAP.md.
3. **Milestone 1 implemented:** see ROADMAP.md §5.
4. **UE C++ spike** in the render VM: it builds. Risk 3 is retired.
5. **Draft PR #1** (`feature/photorealistic-renderer` → `main`) is maintained by the GitHub agent.

## Decisions for the owner

- **Windows build host** (the gate before Milestone 2).
- **Character "The Annotator":** approve the name and mask concept; decide on voice casting and the animation source.
  See the open questions in CHARACTERS.md.
