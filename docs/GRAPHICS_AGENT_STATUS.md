# Graphics agent status

Live coordination file for the graphics division (owner's directives of 2026-10-13: "AAA visual transformation" and
"multi-agent development directive"). The lead (main session) is the Principal Orchestrator: it assigns tasks, owns the
C++ client, HUD, protocol/server boundary, packaging and integration, and updates this file. Nothing is "done" without
evidence and the visual judge.

## Roles (the directive's 15 roles mapped onto agent definitions in `.claude/agents/`)

| Directive role | Agent file | Status |
|---|---|---|
| 1 Principal Orchestrator | lead (main session) | active |
| 2 Technical Architect / GameCore Guardian | `tc-chess-guardian` (+ lead) | existing |
| 3 Independent QA and Release | `tc-oversight` + `tc-github-keeper` | existing |
| 4 Visual Director, 13 Cinematography/Camera | `tc-visual-director` | new |
| 5 Rendering Architect, 7 Lighting/Atmosphere, 14 Performance | `tc-rendering-architect` | new |
| 6 Shader and PBR Materials | `tc-materials-shading` | new |
| 8 Hero Assets/Pipeline, 10 Board/Pieces/Table, 12 Environments | `tc-board-environment` | new |
| 9 Hands and Animation, 11 Opponent/Horror presentation | `tc-hands-character` | new |
| 15 Independent Visual Judge | `tc-visual-judge` | existing |
| Session auditor (owner, 2026-10-13: "audits and looks over this session ... no mistakes") | `tc-oversight` (session-compliance mode) | new task |
| (earlier generalist) | `tc-render-artist` | superseded by the specialists; kept for history |

Roles are merged into five graphics files because every concurrently running agent draws on the same usage limit
(two earlier runs were cut off by it); the responsibilities are unchanged.

## File ownership (edit only your own; ask the lead for the rest)

| Area | Owner |
|---|---|
| `ue5/TownChess/Source/**` (C++: board, HUD, game mode, camera), `packages/**`, `ue5/tools/win/**`, `Scripts/autotest.py`, `capture.py` | lead |
| `docs/VISUAL_ART_DIRECTION.md`; camera block of `build_scene.py` | visual director |
| lighting / post / atmosphere blocks of `build_scene.py`; `Config/DefaultEngine.ini [SystemSettings]`; `docs/graphics/RENDERER_AUDIT.md`, `PERFORMANCE_BENCHMARKS.md` | rendering architect |
| `build_master_material`, `make_mi`, `model_material`, material instances in `build_scene.py`; `ue5/tools/textures/*.py` | materials |
| `build_seated_pose`, `POSES`, `ARM_TARGETS`, `spawn_opponent`, player options in `build_scene.py`; wearables in `props.py` | hands/character |
| board/table/props/room blocks of `build_scene.py`; `props.py` (non-wearables); `fetch_*.py`; `docs/graphics/ASSET_PIPELINE.md`; `docs/FREE_ASSETS.md` | board/environment |
| `docs/pipeline/visual.md` | visual judge |

`build_scene.py` is shared by function: keep edits inside your blocks and rebase before pushing. The Windows build PC is
shared through `ue5/tools/win/lock.ps1` (one builder at a time, <= 45 min per hold).

## Baseline (2026-10-13, commit 7cb3a50; screenshots from UnrealEditor -game -RenderOffscreen, fps from the packaged build of 2026-10-06)

`docs/graphics/baseline/`: base_main, base_black, base_hands, base_opponent (+ metrics.json). Measured against the
reference panel: mean 25.6 (ref 26.6), p95 102.4 (97.1), r/g 1.44 (1.44), g/b 1.64 (1.62), fine detail 11.19 (12.94;
BETA V2 needs 11.5 - not met at baseline). 2560x1440 Auto (Epic + HW RT): 86.9 fps average, 72.1 fps 1% low (packaged, offscreen: no present cost, no CPU/GPU split yet; the VRAM reading was taken after exit and is not valid). Manifest: metrics.json `_manifest`; script `ue5/tools/win/benchmark.ps1`.
Visible defects (lead's first look): the player's hand rests on pieces at the board edge (a knight passes into the palm),
grime reads as leopard spots, flat orange skin, flat-shaded banded sleeve; the patient's sleeves read olive.

## Tasks

| Task | Owner | State | Evidence |
|---|---|---|---|
| A1 Independent inspection of the same baseline (art direction) | visual director | started 2026-10-13 | |
| A2 Renderer audit + profiling (windowed CPU/GPU split, VRAM during play) | rendering architect | started 2026-10-13 | |
| A3 Hands/character audit | hands/character | started 2026-10-13 | |
| A4 Materials audit | materials | started 2026-10-13 | |
| A5 Judge the baseline | visual judge | done: average 5.53, V4/V5 not met, rejected | docs/pipeline/visual.md (6f71140) |
| A6 Session compliance audit (both directives + owner messages) | session auditor | done: 82 requirements, 24 done / 36 in progress / 21 not started / 1 blocked | docs/SESSION_AUDIT.md |
| B Consolidate into one implementation queue | lead | after A1-A5 | |
| Local-model trial (Ollama on the Proxmox host, CPU only) | lead | done: 7 tok/s, small tasks only | plan section 6 |
| A7 Board/pieces/table/asset-pipeline inspection | board/environment | queued (after the first batch, usage limit) | |
| Benchmark gaps: second environment, captured piece in frame, hand-driven move | lead | open (second environment does not exist yet; hand move not built) | |

## Status report 2026-10-14 (owner's continuation directive)

**Recovered from the agents stopped by the usage limit (2026-10-13).** Inspected all 19 worktrees; nothing was reset or
deleted. Recovered and integrated: `hands-impl` WIP commit 4d38db5 (hands rest pose + seat camera; verified and tuned by
the lead: C1 below) and `docs/graphics/ASSET_PIPELINE.md` (sections 1-5; evidence/findings marked incomplete). Preserved
as local commits in their worktrees, not pushed: review5 1c8b4e8 (interrupted pipeline-run-5 chess/visual drafts),
render2 6650e8c (obsolete partial skin.py, superseded by passes 60-64), board-environment 220ed2e (the doc above). The
lighting and materials implementation runs had committed nothing.

**Graphics tasks.** C1 hands contact + camera: done (docs/graphics/iterations/C1-*): hands rest on the table at both
bottom corners, board near edge ~0.84 / far edge ~0.53 of frame height; fingertips 0.85-2 cm over the table, index/middle
up to 2 cm into the board frame (open). cpu 52/52, drag 8/8. Default view now mean 22.8 / p95 96.4 / 49% below luma 8 /
detail 10.13 (V1 mean just under 24: lighting task). C2 lighting (rendering architect) and C3 materials: running.

**Local models (measured).**

| Where | GPU | Runtime | Models | Speed (same 573-token task) |
|---|---|---|---|---|
| Proxmox host | none (RX 6650 XT is passed to VM 131) | Ollama 0.34.3, CPU | qwen2.5:7b-instruct, qwen3:8b | 7.7 / 6.9 tok/s |
| VM 131 (started 2026-10-14) | RX 6650 XT 8 GB, ROCm (gfx1030 override), 100% GPU, busy 99% | Ollama (official installer) | qwen2.5-coder:7b (4.8 GB) | 48.2 tok/s out, 739 tok/s prompt |
| Windows PC | RTX 4070 Ti SUPER 16 GB | none installed | - | proposed (shared with rendering via build.lock) |

VM 131 holds 10 GB of the host's 15.4 GB while running; the three LXCs keep their 5 GB allocation (host reported 12.5 GB
available before start). Access from the host: `townchess-ollama-tunnel.service` (systemd, localhost 127.0.0.1:11435 ->
VM 127.0.0.1:11434 over SSH; no port opened on the LAN). The VM's Ollama has `HSA_OVERRIDE_GFX_VERSION=10.3.0` and
`OLLAMA_KEEP_ALIVE=10m` in `/etc/systemd/system/ollama.service.d/townchess.conf`. Undo: `systemctl disable --now
townchess-ollama-tunnel`, remove the unit; in the VM `sudo systemctl disable --now ollama`.

**Houtini LM.** Registered for this project only (`claude mcp add -s local`): endpoint the tunnel, model
qwen2.5-coder:7b, `HOUTINI_LM_FILE_ROOTS=/root/townchess-work/townchess` (it can read only the repo). It returns analysis
and generated text; it does not edit files. Its tools load in the next Claude Code session.

**Local worker queue: blocked.** Installing a separate coding-agent runtime (Aider) for the unattended queue was refused
by the permission system; the owner's authorization named Houtini LM. The queue design (task file -> isolated worktree
-> worker -> tests -> review queue -> Claude approval) needs either the owner's explicit OK for one runtime or a
permission rule; until then local work runs only through Houtini/Ollama calls that Claude starts and reviews.

**Delegation audit trail.**

| # | Task | Model / GPU | Input | Result | Review |
|---|---|---|---|---|---|
| L1 | Summarise ue5/tools/win/lock.ps1 | qwen2.5:7b CPU | 573 tok | correct, 42.5 s | accepted (benchmark only) |
| L2 | Same | qwen3:8b CPU | 558 tok | one detail wrong, 111 s | rejected |
| L3 | Same | qwen2.5-coder:7b RX 6650 XT | 573 tok | correct, 8.5 s | accepted (benchmark only) |
| L4 | Review capture.py begin() for bugs | qwen2.5-coder:7b RX 6650 XT | 1199 tok, 10.1 s | 6 findings, all false positives (module globals were outside the snippet) | rejected; lesson: task specs must include the interface context (globals/signatures) the snippet uses |
