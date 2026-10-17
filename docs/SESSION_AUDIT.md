# Session audit (session compliance)

Auditor run 1, 2026-10-13, base `6f71140` (rows 37/53 and M8 updated for `93f1134`) (feature/photorealistic-renderer). Scope: the owner's two directives of
2026-10-13 ("TOWNCHESS: AAA VISUAL TRANSFORMATION, RENDERING ENGINEERING, AND LOCAL AI AGENT WORKFORCE", Phases 0-10,
called **D1**; "AAA VISUAL TRANSFORMATION AND MULTI-AGENT DEVELOPMENT DIRECTIVE", sections 1-13, called **D2**), the
follow-up (**F**: start Visual Director, Rendering Architect, Hands, Materials and Visual Judge on the same baseline,
then a real implementation, real rendering/tests on the Windows PC, a session auditor), and the standing owner rules.

What I checked:
- the owner messages in the session transcript (extracted, not read whole);
- the lead's actions since D1 (transcript lines 11654-11804);
- commits `a82c55d` and `6f71140`;
- `docs/GRAPHICS_AGENT_STATUS.md`, `docs/BETA.md`, `docs/graphics/`, `docs/pipeline/visual.md`, `.claude/agents/`;
- `ue5/tools/win/{capture,beta_checks,common}.ps1`;
- the Windows PC, read-only: git state, `C:\TownChess` listing, `builds`, `logs\beta-perf.json`.

Status legend: **done** (evidence exists) / **prog** (in progress) / **todo** (not started) / **blocked**.
Phase A agents were still running when this audit was written. Their deliverables are marked prog, not done.

## 1. Requirement checklist

### Phase 0 / D2 §1 / Stage 1: real project state and SSH
| # | Requirement | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | Inspect repo, remote, branch, commits, working tree | done | transcript l.11671; Windows tree at `7cb3a50` |
| 2 | Identify the engine (UE5 C++ client + TS GameCore; the browser client is secondary) | done | README.md, docs/ARCHITECTURE.md |
| 3 | Source and pipeline that produce the Windows exe | prog | ue5/tools/win/build.ps1, package.ps1, WINDOWS_SETUP.md; not written into the plan |
| 4 | Authority map (rules, GameCore/server, MP/reconnect, Stockfish, hand choreography, presentation, rendering) | prog | in ARCHITECTURE.md, AI.md, NETWORKING.md; not consolidated in the plan |
| 5 | Renderer, API, shader, asset-format, animation and post-processing inventory | prog | Rendering Architect (A2) running |
| 6 | SSH to the Windows PC verified and reused | done | l.11677 (lock FREE, RTX 4070 Ti SUPER 16 GB, driver 616.64) |
| 7 | Reproduce the baseline on the Windows PC | done | docs/graphics/baseline/*.jpg. Caveats: M1, M4 |
| 8 | Baseline report: screenshots, fps, frame times, render config, defects, prioritised list | prog | Have: shots, avg/1% fps, judge defects (6f71140). Missing: frame-time ms, render config, prioritised list |
| 9 | GPU util, VRAM, CPU, RAM measured during a run | todo | one nvidia-smi sample after the run (2169 MiB, 5%), which is idle |
| 10 | Drivers, graphics API, engine version recorded this session | prog | driver and UE 5.8 in WINDOWS_SETUP.md; DX12/SM6/RHI not recorded |
| 11 | Run the real packaging and test pipeline | todo | last runs 2026-10-06 (BETA G2/S1/S2). None this session |
| 12 | Investigate shader compilation, streaming, stutter | todo | |

### D2 §2-§5: agent workforce and workflow
| # | Requirement | Status | Evidence / what is missing |
|---|---|---|---|
| 13 | Inspect the existing agent architecture; keep the gameplay agents | done | docs/AGENT_PIPELINE.md; tc-chess-guardian, tc-oversight, tc-github-keeper kept |
| 14 | Agent 1 Principal Orchestrator | done | lead; GRAPHICS_AGENT_STATUS.md |
| 15 | Agent 2 GameCore Guardian active on the graphics work | prog | tc-chess-guardian exists; not run this session |
| 16 | Agent 3 independent QA/release | prog | oversight + keeper exist; pipeline run 5 was cut off by the usage limit and has not been rerun |
| 17 | Roles 4-15 defined | done | 5 new files in .claude/agents (15 roles merged into 5). See M7 |
| 18 | File ownership, no overlapping edits | done | GRAPHICS_AGENT_STATUS.md ownership table; lock.ps1 on the PC |
| 19 | F: VD, RA, Hands, Materials, Judge started on the same baseline, independently | done | l.11779-11783: all point at docs/graphics/baseline with "do NOT read others" |
| 20 | Step A audits: renderer, materials, hero assets, hands, opponent, environments, performance, agent architecture | prog | 5 of 8 launched. Hero assets/board/environments not launched; opponent is folded into hands; performance is folded into RA |
| 21 | Step B: VD + RA consolidate; lead makes one queue | todo | waiting on A1-A5 |
| 22 | Steps C-F: parallel implementation, integration, verification, repeat (F: "a real implementation") | todo | no code or asset change since D1 |
| 23 | GRAPHICS_AGENT_STATUS.md with ownership, tasks, evidence, defects | prog | exists. Evidence column empty; judge result 6f71140 not recorded |

### Role deliverables (D2 §3)
| # | Deliverable | Status | Evidence / what is missing |
|---|---|---|---|
| 24 | 4 Visual Director: docs/VISUAL_ART_DIRECTION.md | prog | file absent; A1 running |
| 25 | 5 RA: renderer audit, plan, acceptance criteria (docs/graphics/RENDERER_AUDIT.md) | prog | absent; A2 running |
| 26 | 5 RA: RX 6650 XT settings evaluated separately | todo | docs/PERFORMANCE.md has older Linux-VM numbers; VM 131 stopped |
| 27 | 6 Materials: specs, validated changes, before/after | prog | A4 running |
| 28 | 7 Lighting: repeatable lighting setups + screenshots + perf | todo | merged into RA; not in its Phase A brief |
| 29 | 8 Asset pipeline: inventory, missing list, import spec, licences (docs/graphics/ASSET_PIPELINE.md) | todo | tc-board-environment not launched |
| 30 | 9 Hands: measurable improvement of the hand scene and full move animation | prog | A3 audit running; no hand-driven move exists (M6) |
| 31 | 10 Board/pieces/table pass | todo | |
| 32 | 11 Opponent: improved presentation + motion tests | todo | |
| 33 | 12 Environments: ranked plan for all 6 rooms, then passes | todo | |
| 34 | 13 Camera/composition standard | prog | part of A1 |
| 35 | 14 Profiling reports, benchmark script (docs/graphics/PERFORMANCE_BENCHMARKS.md) | prog | absent; RA running |
| 36 | 15 Judge: ranked defect report per milestone | done | docs/pipeline/visual.md @6f71140 (avg 5.53; V4/V5 not met) |
| 37 | D1 final: docs/TOWNCHESS_VISUAL_TRANSFORMATION_PLAN.md (9 sections) | prog | 93f1134 (pushed during this audit): all 9 sections; causes and milestones wait on Phase A |

### Benchmark scene (D1 Phase 4, D2 §8)
| # | Content | Status | Evidence / what is missing |
|---|---|---|---|
| 38 | Board from the normal gameplay camera | done | base_main.jpg |
| 39 | Both hands resting on the board corners | prog | judge: right hand cropped, no wrist; base_hands shows the hand through the pieces |
| 40 | Hands, forearms, watch, sleeve visible | done | base_main (left), base_hands. Defects: mirrored dial, banded sleeve |
| 41 | Several foreground pieces | done | base_main |
| 42 | A captured piece and the surrounding tabletop | prog | -TCPlay=10 may capture; not verified or stated |
| 43 | Opponent across the table | done | base_main, base_opponent |
| 44 | Primary lamp and representative shadows | prog | in frame, but the judge says the lamp reads dead |
| 45 | Second scene: a different environment and material response | todo | base_black is the same room |
| 46 | A complete hand-driven move (animation sequence) | blocked | the feature does not exist (pieces move without the hand: tc-hands-character.md). Needs C++ by the lead |
| 47 | Per run: exe version, commit, settings, resolution, camera, lighting | prog | commit and preset in the status file only. metrics.json has none; camera args only in the uncommitted baseline.ps1 |
| 48 | Capture at the actual development resolution | prog | shots 1920x1080, perf 2560x1440 |
| 49 | docs/graphics/{baseline,iterations,performance} | prog | baseline only; the other two are empty and untracked |
| 50 | Comparison report (9 criteria) + human checklist; motion inspected | prog | judge table covers stills; no motion |

### Local LLMs (D1 Phase 6, D2 §6)
| # | Requirement | Status | Evidence / what is missing |
|---|---|---|---|
| 51 | Inventory installed models and host | done | l.11683: qwen3:8b and qwen2.5:7b-q4_K_M on the Proxmox host. Not written to a doc. Windows PC not checked |
| 52 | VRAM/RAM, quantisation | prog | host 15 GB RAM, no GPU (RX 6650 XT is vfio-bound to the stopped VM 131): CPU-only inference |
| 53 | Inference speed and context limits | done | plan §6 (93f1134): Ollama CPU about 7 tok/s |
| 54 | Remote inference secured? | done | ollama listens on 127.0.0.1:11434 only (l.11683). Not documented |
| 55 | Model capability per task; concurrency with rendering | todo | |
| 56 | houtini-lm: licence, activity, platform, security, MCP fit | prog | gh metadata (Apache-2.0, pushed 2026-10-10) + README read. No written evaluation |
| 57 | local-agent-toolkit: same, incl. macOS/zsh-only, no Windows | prog | metadata only (MIT, 5 stars, pushed 2026-07-11) |
| 58 | Alternatives already compatible with the setup | todo | |
| 59 | Local agent roles A-E with bounded scope | todo | |
| 60 | Token/time/verification metrics; which tasks went to which model | todo | |
| 61 | GPU scheduling plan; RX 6650 XT use (no disruption to Proxmox) | todo | needs owner approval before starting VM 131 for inference |

### Research (D1 Phase 2, D2 §7), strategy, performance
| # | Requirement | Status | Evidence / what is missing |
|---|---|---|---|
| 62 | Techniques: defect fixed, cost, supported, how measured | prog | RA brief covers part of it |
| 63 | Reference games (RDR2, TLOU2, AW2, RE4R, BF/CoD): the 6 questions each | todo | |
| 64 | Phase 3: 9 defect categories with screenshot, cause, files, fix, cost, verification | prog | judge + RA partially |
| 65 | Engine/alternative comparison before any migration | done | docs/RENDERING.md (earlier); no migration proposed |
| 66 | Asset provenance (source, licence, attribution, modifications, use) | prog | docs/FREE_ASSETS.md exists; no "modifications/intended use" columns |
| 67 | 1440p 60 fps on the 4070 Ti S measured | prog | 86.9 avg / 72.1 1% low, offscreen only (BETA S3 partial) |
| 68 | CPU vs GPU ms, frame-time consistency, VRAM, load times, shader stalls | todo | |
| 69 | Real quality tiers; no fake DLSS/FSR/RT | prog | presets exist (Auto = Epic + HW RT); not re-audited |
| 70 | Texture/memory budgets | todo | |
| 71 | Milestones M1-M7 with done/unresolved/commits/test results | prog | M1 in progress; M2-M7 not started |

### Quality gates and standing rules
| # | Rule | Status | Evidence / what is missing |
|---|---|---|---|
| 72 | Visual gate | todo | judge avg 5.53; V3/V4/V5 not met |
| 73 | Gameplay gate (rules, MP, reconnect, settings) | prog | last met 2026-10-06 (479/479, autotests); not rerun since. No gameplay code changed |
| 74 | Performance gate | prog | see 67-68 |
| 75 | Delivery gate (organised source, logs, provenance, shots in repo, no unproven "done") | prog | M1, M2, M3 below |
| 76 | GameCore authority / renderer never authorises moves | done | no protocol/server/rules change since D1 |
| 77 | Regression test per chess fix; test count never drops | done | no chess fixes this session (n/a); 479 last count |
| 78 | No paid assets; licences recorded | done | nothing added |
| 79 | No secrets committed | done | grep of tracked files: no tokens/keys (one false positive: a Sketchfab URL) |
| 80 | No force-push, no merge, never touch main | done | only fast-forward pushes a82c55d, 6f71140 |
| 81 | Windows rules (workspace only, no system change, changes recorded) | prog | baseline.ps1 written inside C:\TownChess (ok). WINDOWS_SETUP row 13 is inaccurate (M11) |
| 82 | F: a session auditor exists | done | this file |

Tally: **done 24, in progress 36, not started 21, blocked 1** (82 rows, standing rules included).

## 2. Mistakes and risks (newest first)

- **M1. The baseline is labelled with the wrong source.** GRAPHICS_AGENT_STATUS.md says "packaged build of 2026-10-06".
  But the four screenshots came from `capture.ps1`, which runs `UnrealEditor.exe ... -game -RenderOffscreen` on the
  project. Only the perf number used the packaged `TownChess.exe` (`beta_checks.ps1`).
  *Fix:* state both sources in the status file and in metrics.json.
- **M2. The performance claim is thin.** The commit message says "86.9/72.1 fps at 1440p". That figure is offscreen
  (no present or vsync), has no frame-time ms and no CPU/GPU split. The VRAM figure (2169 MiB, 5%) was sampled after
  the game had exited.
  *Fix:* do a windowed run with `stat unit` / CSV profiler and sample nvidia-smi during the run. Write the results to
  docs/graphics/PERFORMANCE_BENCHMARKS.md. Keep BETA S3 "partial" until then.
- **M3. BETA.md V2 is stale or regressed.** BETA.md says V2 is met (11.54 at pass 64, spread about 0.1). The new
  baseline measures 11.19 (base_black 10.6).
  *Fix:* check whether the capture conditions differ (HUD on, -TCPlay=10, 1920x1080) or the scene regressed. Update
  V2. Also set V5 to "not met": the judge found the hand clipping through pieces and a mirrored watch dial.
- **M4. The baseline is not repeatable from the repo.** baseline.ps1 (camera arguments, preset, warm-up) lives only
  in the lead's scratchpad and in C:\TownChess. metrics.json has no commit, exe date, preset, resolution, camera or
  lighting, all of which D2 §8 requires.
  *Fix:* commit it as `ue5/tools/win/benchmark.ps1` and write a run manifest next to each capture.
- **M5. The benchmark is missing three required contents:**
  - a second environment;
  - a verified captured piece;
  - a hand-driven move.
  The hand-driven move cannot exist yet: pieces move without the hand. The owner's original spec asked for the hand
  to grab and carry pieces. This is the oldest open visual gap and is not on the task list.
  *Fix:* add it as an explicit task (hands design, lead C++), with the GameCore Guardian reviewing it.
- **M6. Scope coverage in Step A is incomplete.** The board/environment specialist was never launched. That leaves
  hero assets, ASSET_PIPELINE.md, the board pass and the environments unowned. Lighting (7) and performance (14) are
  only partly inside the RA brief.
- **M7. Roles were merged 15 into 5.** The status file justifies this by the usage limit. It is acceptable, but the
  merged roles' deliverables must still be produced: lighting setups, camera standard, profiling reports and the
  opponent pass. Six agents running at once on the same limit risks the cut-offs the status file itself mentions.
  *Fix:* stagger the next wave.
- **M8. Promised deliverables are missing.** The plan landed in 93f1134 while this audit ran. Four of the six §13
  documents still do not exist: VISUAL_ART_DIRECTION, RENDERER_AUDIT, ASSET_PIPELINE, PERFORMANCE_BENCHMARKS.
- **M9. No QA has run since 2026-10-06.** Pipeline run 5 was cut off and never rerun. Before any visual change merges,
  rerun npm test (at least 479), the UE autotests and test_package.
- **M10. Local-LLM work is undocumented.** The model list, the CPU-only constraint (the RX 6650 XT is passed through
  to the stopped VM 131) and localhost-only binding are in the transcript only.
  - Using the AMD GPU for inference means starting VM 131 and installing a runtime there. That is a system change
    and needs owner approval.
  - Installing houtini-lm (an MCP server that can also call cloud APIs) changes the configuration. It needs a
    security note and approval.
  - The Windows PC was not checked for Ollama.
- **M11. WINDOWS_SETUP.md row 13 is wrong.** It says the launcher's project copy was deleted. But two untracked copies
  still exist on the PC: `ue5\TownChess 5.8\` (10-03) and `ue5\TownChess 5.8 - 2\` (10-04), plus an untracked
  `Config/DefaultInput.ini`. Do not delete them without the owner. Correct the doc.
- **M12. Ad-hoc scripts on the PC.** About 20 scripts in C:\TownChess (lead1-9, leadA/B/P/Q, q*.ps1) are not in the
  repo, which hurts reproducibility. Keep only committed tools.

## 3. Top 10 next actions (in order)

1. When A1-A5 report, record their evidence and the judge's run (6f71140) in GRAPHICS_AGENT_STATUS.md. Update BETA.md
   V2 (11.19 at baseline, with conditions) and V5 (not met).
2. Commit the benchmark script and a per-run manifest (commit, exe date, preset, resolution, camera, lights). Re-shoot
   the baseline at 2560x1440. Add the second-environment scene and a verified captured piece.
3. Step B: VD and RA consolidate into one ranked queue, top 3-5 failures. Write
   sections 3 and 7 of docs/TOWNCHESS_VISUAL_TRANSFORMATION_PLAN.md from it.
4. First real implementation, the judge's #1 defect: hand pose and contact (fingers through pieces, deformed fingers,
   right hand cropped, mirrored dial). Re-capture with identical cameras and have the judge re-score.
5. Lamp as key light and de-grade, then materials (table scars, sleeve banding). Measure before/after with
   V1/V2 + judge, not the grade alone.
6. Windowed perf run (stat unit/CSV, GPU vs CPU ms, p99 frame time, VRAM during play, load time). Write
   docs/graphics/PERFORMANCE_BENCHMARKS.md.
7. Launch the board/environment specialist: ASSET_PIPELINE.md, asset inventory and missing-asset list, a ranked plan
   for the 6 environments.
8. Hand-driven move: hands specialist designs it, lead implements it in C++, guardian confirms animation never gates
   move acceptance. Then add it to the benchmark as a frame sequence.
9. Local-LLM evaluation doc, covering:
   - CPU trial results (tok/s, quality per task);
   - houtini-lm vs local-agent-toolkit (licence, Windows support, security);
   - a written proposal for RX 6650 XT inference via VM 131, sent to the owner and not applied.
   Then delegate one bounded task and log the model, time and verification.
10. Before merging any visual change, rerun the QA gate (npm test >= 479, autotest suite, test_package) and pipeline
    run 5. Ask the owner about the untracked UE copies and fix WINDOWS_SETUP row 13.
