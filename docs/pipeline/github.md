# GitHub keeper report (stage 4)

Branch `feature/photorealistic-renderer`, GitHub constantlods/townchess, draft PR #1 into `main`.

## Run 2: 2026-10-05

### F1: pushed `a78d7a1..3383297` (4 commits), no force push
- `7eda444` run-2 fix screenshots (pass 39), `d6f577c` project audit run 2, `9856d83` capture/decal/cage-tint fix,
  `3383297` screenshot byte-strip.
- `e981f32` (chess run 2), `a386544` (visual report) and `d52651f`/`a78d7a1` were already on GitHub before this
  stage ran: `git fetch` showed the branch only 4 ahead, 0 behind.
- Evidence: `git pull --rebase`: "Current branch feature/photorealistic-renderer is up to date"; push output
  `a78d7a1..3383297  feature/photorealistic-renderer -> feature/photorealistic-renderer`.
- This report is committed and pushed on top.

### F2: PR #1 body updated (yes)
- `gh api -X PATCH repos/constantlods/townchess/pulls/1 -F body=@file` returned `updated_at 2026-10-05T04:07:24Z`,
  `draft true`, `state open`, body 23,711 characters, ends with the Claude Code line.
- "Current state" rewritten for run 2: both test counts, chess run 2 (BUG-007 fix reviewed, seed 41, 60 games /
  0 anomalies), visual scores run 1 -> run 2, the lead's fixes, open problems, pass 39 evidence links.
- Run-2 corrections stated plainly in the body:
  - left hand still a fist; IK `player r` error 123.5 (left 24.8), "arms reach the corners" was not true;
  - the exposure bisect was one-sided (no `TC_HAND_DECALS=1` control rebuild), root cause unknown;
  - cage rust tint lowered in `9856d83` (`grime_color` 1.5/0.75/0.35, threshold 0.62) but no capture was taken
    after it, and the values are still above 1. The f/g decal removal in the same commit is also not re-captured.
- Stale lines fixed: passes 00-31 -> 00-39, sim 51 -> 60 games, MetaHuman scores, Black-seat status.

### F3: branches left for the owner (nothing deleted)
- Remote: `agents/stockfish-league`, `agents/rules-audit-2`, `claude/horror-chess-prototype` still present.
- Local: `agents/rules-audit-2` and three `worktree-agent-*` branches/worktrees are stale; not touched.

### F4: nothing blocked

### Checks before pushing (at `3383297`)

| Check | Result |
|---|---|
| `TC_STOCKFISH=tools/.cache/stockfish/stockfish-linux-x86-64-universal npm test` | `Test Files 19 passed (19)`, `Tests 475 passed (475)` |
| `npm test` (TC_STOCKFISH unset) | `Test Files 19 passed (19)`, `Tests 474 passed \| 1 skipped (475)` |
| Large files: `git diff --stat origin/...HEAD` | 36 files, +132/-78; 34 PNGs, largest 3.76 MB; no file over 5 MB added. Largest tracked file 8.3 MB (`T_HandlingGrime_Normal.png`) |
| PNG integrity after the byte-strip | every tracked PNG ends exactly at `IEND`; tracked screenshots 102 MB (audit: 119 MB before) |
| Secrets: diff grep (password/token/AUTH_/PRIVATE KEY/ssh-rsa/ed25519/ghp_/github_pat_) | 1 hit, audit prose ("No secrets in the diff ... no tokens"); no actual secret |

### Carried to the next run
- Capture after `9856d83` to verify the cage tint and the f/g decal removal.
- Screenshot weight (102 MB tracked): JPEG or LFS per audit F7.

---

## Run 1: 2026-10-04 (first run of this stage)

#### Findings (newest first)

#### F1: pushed `fd4c24f..28b3976` (5 commits), no force push
- `c791d46` chess guardian run 1 (BUG-007 pinned), `7cdc067` BUG-007 fix, `f895b14` sim node budgets,
  `49b4cdf` project audit run 2, `28b3976` oversight follow-ups.
- Evidence: `git push` output `fd4c24f..28b3976  feature/photorealistic-renderer -> feature/photorealistic-renderer`.
  `git pull --rebase` before it: "Current branch feature/photorealistic-renderer is up to date" (no remote changes).
- This report is committed and pushed on top as a sixth commit.

#### F2: PR #1 body updated (yes)
- `gh api -X PATCH repos/constantlods/townchess/pulls/1 -F body=@file` returned `updated_at 2026-10-05T02:15:56Z`,
  `draft true`, body 22,308 characters. Read back: starts with `## Summary`, ends with the Claude Code line.
- New section "Current state (pipeline run 1)": both test counts, chess guardian findings (BUG-007, sim budgets,
  51 games / 0 anomalies), visual judge scores (pass 27), the oversight audit's 8 open problems, screenshot links
  (31-main, 31-board-closeup, 31-opponent-closeup, 27-main, 22-reference-pass).
- Stale lines fixed: test count 446 -> 475, passes 00-06 -> 00-31, the simulator/Stockfish/MetaHuman "not yet done"
  lines, the "Requested next" list (now with status), pipeline and free-assets docs links.
- The PR stays a draft; nothing was merged and `main` was not touched.

#### F3: branches left for the owner (nothing deleted)
- `origin/agents/stockfish-league`: merged into this branch, not deleted. Owner to decide.
- `origin/claude/horror-chess-prototype`: equal to `main` (per the audit). Owner to decide.
- `origin/agents/rules-audit-2`: merged earlier (`20fb5e8`); still on the remote.
- Local: three agent worktree branches (`worktree-agent-*`) are stale; not touched.

#### F4: nothing blocked
- `gh pr edit` was not tried (known to fail on this repo, Projects classic); the API PATCH worked.

### Checks before pushing

| Check | Result |
|---|---|
| `TC_STOCKFISH=tools/.cache/stockfish/stockfish-linux-x86-64-universal npm test` | `Test Files 19 passed (19)`, `Tests 475 passed (475)` |
| `npm test` (no engine) | `Test Files 19 passed (19)`, `Tests 474 passed \| 1 skipped (475)` |
| Large files: `git diff --stat origin/feature/photorealistic-renderer..HEAD` | 10 text files (docs, `uciEngine.ts`, `uci.test.ts`, `simulate.ts`), +254/-88, no binaries |
| Secrets: diff grep for password/token/AUTH_/PRIVATE KEY/ssh keys | 3 hits, all audit prose describing the secrets check (`AUTH_PASSWORD` named as something searched for); no actual secret |

### Carried to the next run
- Merge commits authored `root@Fpc.pve2` (audit F8): set the git identity before the next merge.
- Screenshot growth (84 MB tracked): only kept passes should be committed (evidence rules).
