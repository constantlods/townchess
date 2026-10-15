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

## Status 2026-10-14 (evening): C2 lighting and C3 materials integrated

| Task | Owner | State | Evidence |
|---|---|---|---|
| C2 lighting (lamp shadows only, lamp key, haze, grade) | rendering architect | done, lead-reviewed: C2.2 rejected for white-piece readability (white median 11.6), fixed in C2.3 with a shadowless table bounce (white 74.8, white/black 17.8) | C2-*.jpg, C2-lighting.json; GPU 11.57 -> 8.42 ms (editor, 1440p auto); packaged offscreen 116.1 / 96.3 fps |
| C3 materials (crease dirt, jacket fix, wood pieces, bed/cart scans, detail layer) | materials | done, lead-reviewed; judge pending | C3-*.jpg, C3-materials.json; tests cpu 78/78, drag 8/8 |
| D1 screen percentage per tier | lead | coded (Cinematic 100, Epic 83, High 67, Medium 58, Low 50; `-tcscreenpct=`); packaged benchmark pending | TCGame.cpp ApplyQualityPreset |
| C4 board/props/room V5 defects | board/environment | done b2f8380 except rook specks (Lumen/TSR noise, needs RA) and lamp head (faces the camera; C4.1 running); V1 in bounds both seats (main 29.6/95.3/1.472/1.699, Black 27.6/89.2/1.485/1.698), detail 9.56; cpu 220/220, drag 8/8 | C4-*.jpg, C4-board-env.json |
| D1 verified | lead | Epic 83%: packaged offscreen 82.3 / 71.7 fps | PERFORMANCE_BENCHMARKS.md |
| C4.1 lamp head, books, pill bottle | board/environment | done f086766, lead-reviewed (dome mouth-down, bulb hidden) | C4.1-*.jpg |
| QA gate on f086766 | lead | all pass (autotests, reconnect 103/103, S2 10/10, npm 479) | docs/evidence/gate-2026-10-14.txt |
| C5 hands round 2 | hands/character | done a266f7c, lead-reviewed: pose calibrated to the mesh (fingertips 0.5-0.7 cm on frame/table), relaxed curl, smooth sleeve, patient steepled hands + breathing idle, hand decal Rotator fixed; cpu 306/307 (ply budget), drag 8/8 | C5-*.jpg, C5-hands.json |
| QA gate on C5 (8d71234) | lead | all pass: cpu 114/114, drag, keys, rematch, promo, reconnect 76/76, S2 10/10, perf 81.4/72.7 | docs/evidence/gate-2026-10-15.txt |
| C6 sleeve canvas, piece AO cavity, deep gouges | materials | done 06ace58, lead-reviewed; rook specks not fixed (lighting/GI noise in the crown pocket, sent to RA); skin roughness from dirt open | C6-*.jpg, C6-materials.json |
| Decal materials logged 'Failed to compile ... PCD3D_SM6' | lead | fixed: blend mode set before the decal domain (transient compile on the default opaque blend; final material was fine) | build_scene.py |
| Visual judge re-score (V3/V4/V5) | visual judge | done run 6: average 6.00 (baseline 5.53), V3/V4/V5 not met; top gaps: lamp/shadow noise (RA), hand skin (hands+materials), clean opponent (materials), procedural wood (materials+board), story props (board) | docs/pipeline/visual.md, docs/graphics/judge/run6-* |
| C7 rook specks, gown dither, lamp, cold rim | rendering architect | done fa8223f, lead-reviewed: rook specks are real crenel shadows from the grazing key (16 A/B tests; no lighting fix without losing the lamp shadows) -> materials mask / board mesh; gown dither is the jacket weave normal (G-buffer) -> materials; Lamp_Opponent 170 -> 140 lm, Rim 500 lm 9000 K; V1 main 29.74/96.9/1.468/1.658; cpu 32/32, drag 8/8 | C7-*.jpg, C7-lighting.json |
| capture.py -TCGamePath=1 (capture at the game's screen percentage + TSR, C7 request) | lead | done | capture.py |
| C8m opponent filth, skin roughness, wood textures (+ gown weave fade, rook floor mask from C7) | materials | running | |
| C8b judge defects (decal edge, wall panel, lamp underside, clipboard header), WARD B sign | board/environment | done fb8e0c3, lead-reviewed: decals inside the table edges, cabinet faces the room, lamp mouth warm enamel + brass rim, single clipboard header, WARD B sign in the main view; V1 main 29.5/94.0/1.473/1.670 (game path 29.9), detail 9.81; cpu 16/16, drag 8/8. Open: window/cold source above the frame (RA: move Window_Cold + window), watch bezel flat normals (hands: smooth SM_WatchBody), knight faceting is mesh geometry | C8b-*.jpg, C8b-board-env.json |
| C7 rook-crown specks (shadow/GI noise) | rendering architect | started | |

Open after C2/C3: V2 detail (C3 metric 9.47 on the new recipe, lower than C2 because the white bed grids were background detail);
Black seat r/g 1.514 (V1 limit 1.50); pieces have no cavity bake; skin roughness not driven by dirt; lamp source not visible.
