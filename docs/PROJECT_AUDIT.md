# Project audit (oversight agent, 2026-10-04)

Scope: every request the owner made in the session (both directives, the chat messages, and the queued messages),
checked against the branch `feature/photorealistic-renderer` at `1a55845`, the docs, and GitHub. Status values:
**done-verified** (evidence re-checked by this audit), **done-unverified** (claimed in a commit/doc, no independent
evidence), **in progress**, **not started**, **dropped**. Test suite re-run for this audit: **446/446 pass**
(18 files, Linux).

## 1. Owner requests

| # | Request | Status | Evidence | Gap |
|---|---|---|---|---|
| 1 | Native UE5 game is the primary product, Windows first; browser secondary | done-verified | `ue5/TownChess`, ROADMAP §4 | none |
| 2 | GameCore is the only chess authority; UE never decides legality | done-verified | ROADMAP §5b rejection test; `ATCBoard` animates only accepted `effects` | none |
| 3 | Every chess bug gets a regression test first; test count never drops | done-verified | BUG-001..006 in KNOWN_LIMITATIONS, `regressions.test.ts`; 305 → 407 → 409 → 446 | Counts in README (407), REPORT (407), SESSION_SUMMARY (407) and ENGINE_AGENT ("3 expected failures") are stale |
| 4 | Locked-pawn dead position stays tracked | done-verified | LIM-001 open, `limitations.test.ts` | none |
| 5 | M2 gameplay definition of done (handshake, seats, markers, rejection, special rules, clocks, CPU game, UE↔browser, reconnect) | done-verified (Linux, strict re-run) | ROADMAP §5b table, `0ec56ec`, `34322b9`, `8a863f6` | Real mouse + on-screen HUD never verified (see 7) |
| 6 | M2 Windows sidecar proofs: packaged build, ephemeral port, per-launch secret, Job Object, no orphan, AV, packaged reliability | done-verified (scripted) | `1fbabf5`, `e7092a8`, `test_package.ps1`, ROADMAP §5b | **Sidecar crash recovery** seen once by accident, not scripted. **Correlated logs** only described (NETWORKING.md), no test asserts it. "Packaged reliability" = one 12-ply smoke, no repeat runs |
| 7 | Owner can launch and play a full game interactively | not verified | ROADMAP §5b last row "Pending" | Owner hit the VC++ runtime check (fix: UE's `vc_redist.x64.exe`, 14.50). No record that the owner then played a game with the mouse |
| 8 | Windows PC security rules + change record | partly | WINDOWS_SETUP.md rows 1-8 | Not recorded: VC++ 14.50 redistributable (owner, on our advice), MetaHuman plugin + MetaHuman Core Data install, Epic sign-in in the editor, reference image copied to `C:\TownChess`. See risk R1 |
| 9 | Never commit secrets / personal data | done-verified (tree + history) | grep of tree and all history: no keys, tokens, `AUTH_PASSWORD`, signed URLs, Windows user or host names | History keeps `ue@192.168.0.223` (`079c1bf`, removed in `b490b30`) and `192.168.0.208` in PERFORMANCE.md: private LAN only, low risk. Merge `20fb5e8` is authored `root@Fpc.pve2` |
| 10 | Big generated binaries not committed | done-verified | `ue5/TownChess/.gitignore` ignores `Content/`, `Saved/`; largest tracked file 3 MB (screenshot); `.git` 28 MB `tools/.cache/` (178 MB Stockfish + tarball) is now ignored (`1a55845`). But `tools/sim/out/report.json`, a generated run output, was committed in `1a55845`; `tools/sim/out*` is not ignored |
| 11 | Visual rebuild toward the reference, critique → render → compare loop, documented | in progress | HOSTILE_VISUAL_REVIEW.md, VISUAL_REBUILD_ROADMAP.md, passes 00-06 in `docs/screenshots/visual-loop/` | No capture or log entry since pass 5; MetaHuman passes (`c37fb39`..`0505eea`) are not in the loop log; VISUAL_REBUILD_ROADMAP gap #1 still says "opponent is a mannequin, needs owner sign-in" (stale) |
| 12 | MetaHuman opponent wearing the cage mask | done-unverified | `9343527`..`0505eea`, `ue5/tools/win/metahuman.ps1` | No screenshot of the MetaHuman in the seat; no hostile review of it; no doc of the pipeline (owner steps, preset "Walter", licence) |
| 13 | Multi-agent pipeline: critique, GitHub keeper, rules verifier, oversight | done (ad hoc) | critique reports in ROADMAP/HOSTILE review, `agents/rules-audit-2` merged, this file | Directive 2 also asked for gameplay, network and **performance** agents: no performance pass since Milestone 0. The GitHub keeper let the PR body go stale (§3) |
| 14a | Character selection: player picks own character/hands, opponent picks theirs, player chooses opponents | not started, **not tracked** | none | Not in any roadmap |
| 14b | Board flips by itself between games (colours swap on rematch) | partly | Server/core rematch swaps colours (REPORT.md); UE has a Rematch button (`TCGame.cpp`) | No test that the UE seat camera flips on rematch; not tracked as a UE item |
| 14c | Move list + opening on an asylum clipboard on a cart beside the table, toggleable, instead of HUD text | not started, tracked only as "analysis cart v1" (ROADMAP M4) | ROADMAP §4 M4 | Clipboard/notepad look and toggle not written down |
| 14d | A critique pass before 14c | not started | none | none tracked |
| 14e | Simulations: historical games, openings, CPU vs CPU at different Elo, agent watching for bugs | in progress | `1a55845`: `tools/sim/` (Stockfish 19 as referee); committed report = 5 classic games, 0 anomalies | No CPU-vs-CPU Elo ladder run reported yet; not in the vitest suite or any roadmap; runs headless in Node, not "CPUs in the game" in UE; no standing watcher agent |
| 14f | Install Stockfish (and similar) as league-level opponents in the game | in progress (referee only) | `tools/.cache/stockfish` (ignored), used by `tools/sim/` | No engine service in the game, no CPU levels backed by it, other engines (Lc0 etc.) not evaluated. GPL: must stay a separate process and ship its licence (AI.md) |
| 15 | The Annotator approved as the first original character | in progress (design only) | CHARACTERS.md | The in-game opponent is an Epic preset MetaHuman with a cage mask, not the Annotator (riveted steel mask, ledger). See R3 |
| 16 | Voice/animation pipeline, provider-agnostic, no spend | research done | VOICE_OPTIONS.md | No pipeline code; no commentary playback in UE |
| 17 | Physical interaction (reach/grip/lift/place), M3 | not started | ROADMAP M3 | none |

## 2. Incorrect or risky things found

- **R1 Windows rule breach (minor).** On 2026-10-04 an agent ran `Get-CimInstance Win32_Process` on
  `UnrealEditor.exe` and printed its full command line, which contained the Epic launcher's
  `-AUTH_PASSWORD` exchange code. It is now stored in the session transcript on the Proxmox host. It is not in
  the repo. Exchange codes are short-lived, but the owner's rule says "never extract credentials". In future, filter
  by process name and PID only. The same command also listed `%LOCALAPPDATA%\UnrealEngine` (outside the workspace).
- **R2 The PR description was wrong, not just old.** Its M2 table quoted the pre-correction numbers (66 plies 69/69,
  15/15, 19/19) that ROADMAP §5b withdrew as unfalsifiable. It still said the packaged build was pending and UE was
  installing. Fixed by this audit (§3).
- **R3 Character direction drift.** The approved Annotator (records clerk, original riveted mask, ledger) and the
  current opponent (asylum patient, Epic "Walter" preset, wire cage mask from the reference sheet) are different
  characters. A cage-masked asylum inmate across a table is also close to a famous film character, which the
  owner's "no copying copyrighted horror characters" rule warns about. Needs an owner decision.
- **R4 Generated output committed.** `1a55845` committed `tools/sim/out/report.json` (a run artifact that will churn
  on every run) and mixes MetaHuman and simulator changes in one commit. Ignore `tools/sim/out*/` and keep curated
  results in a doc instead. (The `tools/.cache/` ignore rule landed in the same commit, so Stockfish is safe.)
- **R5 `docs/reference/concept-reference.jpg` is public.** VISUAL_REBUILD_ROADMAP says the owner's reference is
  kept off the public repo, but an earlier concept reference is committed (`a4d49ec`). Its source/licence is not
  recorded.
- **R6 Stale docs.** README, REPORT and SESSION_SUMMARY say 407 tests; ENGINE_AGENT lists BUG-005/006 as expected
  failures although `b072814` fixed them; ROADMAP §5b is dated 2026-10-03 and says nothing about the visual or
  MetaHuman work.
- **R7 Stale branches.** `agents/rules-audit-2` is merged but still on GitHub; `claude/horror-chess-prototype`
  equals `main`. No branch protection on `main` (only the agents' discipline stops a push to it).
- **R8 Third-party mask asset.** HOSTILE_VISUAL_REVIEW lists Sketchfab masks as candidates. The committed
  `ue5/assets/props/cage_mask.obj` is Blender-authored by us (`props.py`), which is fine; keep it that way or record
  each licence.

## 3. GitHub state (2026-10-04)

- Repo public, default branch `main` (= `a4d49ec`, the prototype). Branches: `main`, `feature/photorealistic-renderer`
  (`0505eea`), `agents/rules-audit-2` (merged), `claude/horror-chess-prototype` (= main). None protected.
- PR #1: draft, open, 54 commits, not merged. Description rewritten by this audit to match the branch.
- No issues are used; tracking lives in ROADMAP.md and this file.

## 4. Next actions (priority order)

1. Ignore `tools/sim/out*/` (R4); run the CPU-vs-CPU Elo ladder (`--games 40`) and report the anomalies in a doc;
   add a small seeded simulator run to CI or the test suite so the watcher actually runs on every change.
2. Owner: launch the packaged build after the VC++ 14.50 fix and play one full game with the mouse; record the result
   in ROADMAP §5b (item 7). Add rows to WINDOWS_SETUP.md for the redistributable, MetaHuman plugin/Core Data and the
   editor sign-in (item 8).
3. Capture the MetaHuman opponent from the player's seat, add it as pass 07 to VISUAL_REBUILD_ROADMAP, run the
   hostile review on it, and fix the stale gap list (items 11, 12).
4. Owner decision on R3: is the opponent the Annotator, a separate "patient" character, or both (roster)? This also
   shapes 14a.
5. Write the new features into ROADMAP.md: character/hands/opponent selection (14a), UE seat flip on rematch with a
   test (14b), the clipboard cart with toggle plus its critique pass (14c, 14d), Stockfish engine service and
   league ladder (14f). Suggested placement: 14b now (small), 14c+14d in M4, 14f in M5, 14a in M9 or earlier if the
   owner wants it.
6. Script the sidecar-crash-recovery test and assert correlated logs in `test_package.ps1`; run the packaged smoke
   several times in a row (item 6).
7. Fix stale test counts and ENGINE_AGENT (R6); delete the merged `agents/rules-audit-2` branch (R7, owner OK).
8. Performance pass of the new scene (MetaHuman, layered materials) on the RTX 4070 Ti SUPER and RX 6650 XT.
