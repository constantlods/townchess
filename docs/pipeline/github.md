# GitHub keeper report (stage 4)

Branch `feature/photorealistic-renderer` on GitHub constantlods/townchess, draft PR #1 into `main`.

## Run 4: 2026-10-06 (BETA focus)

### F1: pushed `2cab890..ad699b6` (4 commits), no force push
- `4e1d313`: chess guardian run 4 (chess.md).
- `826c82b` and `051326d`: visual judge run 4. The second commit adds pass 59, which the lead pushed during the run.
- `ad699b6`: project audit run 4 (PROJECT_AUDIT.md, the BETA row audit).
- `git pull --rebase origin feature/photorealistic-renderer` was clean: the lead's `2cab890` (BETA C2 + 59-skins)
  came in under the 4 docs-only commits.
- Push output: `2cab890..ad699b6  HEAD -> feature/photorealistic-renderer`. It used the refspec `HEAD:` and the
  prescribed credential flags. Nothing went to `main`.

### F2: verification before the push
- `npm test` with TC_STOCKFISH: 479/479. Without it: 478 passed + 1 skipped (479). Both runs on the rebased head.
- Diff `origin..HEAD`: 3 files, all docs (PROJECT_AUDIT.md, pipeline/chess.md, pipeline/visual.md). No binaries.
  Nothing over 10 MB is tracked: the largest file is 8.3 MB, `T_HandlingGrime_Normal.png`.
- Secrets grep (PRIVATE KEY / ghp_ / github_pat / AKIA): one hit, the audit's own prose that describes the scan.

### F3: PR #1 body updated (yes), with `-F body=@file`
- The Summary was rewritten for the beta target.
- "Current state" is now run 4, with:
  - both test counts;
  - the startFen verification;
  - the **BETA status table**: the lead's status next to this run's audit, row by row;
  - the visual scores (average 5.2) and the top 8 fixes;
  - the audit's open items and evidence links (58-main, 54-hud-portraits, 57/59 skins, 52-watch).
- The sections from "Progress" down are unchanged.
- PATCH result: `2026-10-06T09:55:26Z draft=true state=open`. The body ends with the Claude Code line.

### Blocked / not done
- Nothing was run on the build PC: another session holds `C:\TownChess\build.lock`. The audit used read-only file
  reads only.
- The PR is still a draft. Not merged, not marked ready.


## Run 3: 2026-10-05 (milestone "gameplay feel + reference HUD + packaged build")

### F1: pushed `de25f4a..5f92f46` (3 commits), no force push
- `b7cab8a`: chess guardian run 3 (chess.md, BUG-008 in KNOWN_LIMITATIONS).
- `a52ce49`: visual judge run 3.
- `5f92f46`: project audit run 3.
- The lead pushed in parallel while stages 1-3 ran: `d97fa14`, `c14e510`, `c160e11`, then `de25f4a`. `git pull
  --rebase` was needed twice and was clean both times; the pipeline commits only touch docs.
- Push output: `de25f4a..5f92f46  HEAD -> feature/photorealistic-renderer`.
- The pipeline ran in its own worktree on a local branch tracking the feature branch. The main checkout has the
  feature branch checked out, so the push used the refspec `HEAD:feature/photorealistic-renderer` with the
  prescribed credential flags. Nothing went to `main`.
- This report is committed and pushed on top.

### F2: PR #1 body updated (yes), after a 10-second slip
- `gh api -X PATCH .../pulls/1 -f body=@file`, as written in `.claude/agents/tc-github-keeper.md`, sends the literal
  text `@pr_new.md`: `-f` does not read files.
- For about 10 s (02:26:48Z) the PR body was that string. Re-sent with `-F body=@file` at 02:26:58Z. The result is
  draft true and state open, and the body ends with the Claude Code line.
- **Fix the agent definition: use `-F`** (run 2 already used `-F`).
- "Current state" is rewritten for run 3:
  - both test counts;
  - the UE autotest and packaged-build evidence, with the caveat that the autotests predate the HUD;
  - the chess run 3 findings: seed 73, 73 games, 0 anomalies, BUG-008, no key autotest;
  - visual scores run 2 -> 3 (HUD 5/10; the quality preset has no visual proof);
  - the audit's open items and evidence links (41-hud, 40-*, 39-annotator).
- Stale lines fixed: passes 00-39 -> 00-41, sim 60 -> 73 games, the MetaHuman scores line. The merged-branch item
  was removed: the branches are deleted.

### F3: branches
- Remote: only `main` and `feature/photorealistic-renderer` (`git ls-remote --heads`). The owner-approved deletion
  is done.
- Local: `agents/rules-audit-2` (its remote is gone) and the worktree branches. Not touched.

### F4: nothing blocked

### Checks before pushing (rebased head `5f92f46`)

| Check | Result |
|---|---|
| `TC_STOCKFISH=.../stockfish-linux-x86-64-universal npm test` | `Test Files 19 passed (19)`, `Tests 475 passed (475)` |
| `npm test` (TC_STOCKFISH unset) | `Test Files 19 passed (19)`, `Tests 474 passed \| 1 skipped (475)` |
| Large files: `git diff --stat origin/...HEAD` | 4 files, all docs (`KNOWN_LIMITATIONS`, `PROJECT_AUDIT`, `pipeline/chess`, `pipeline/visual`); no binaries. Largest tracked file 8.3 MB |
| Secrets: diff grep (password/token/AUTH_/PRIVATE KEY/ssh-rsa/ed25519/ghp_/github_pat) | 1 hit: audit prose describing the scan; no actual secret |

The tests ran before the second rebase. The only upstream commit pulled then, `de25f4a`, changes
`build_scene.py` (no `packages/`), so the counts stand.

---

## Run 2: 2026-10-05 (condensed)
- Pushed `a78d7a1..3383297` (4 commits: pass-39 screenshots, audit run 2, the capture/decal/cage-tint fix, the
  screenshot byte-strip).
- PR body updated with `-F body=@file`, including the run-2 corrections: left hand still a fist, the one-sided
  exposure bisect, cage tint not re-captured.
- Tests: 475/475 with TC_STOCKFISH, and 474 + 1 skipped without.

