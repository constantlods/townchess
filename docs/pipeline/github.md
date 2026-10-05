# GitHub keeper report (stage 4)

Run: 2026-10-04, branch `feature/photorealistic-renderer`, GitHub constantlods/townchess, draft PR #1 into `main`.
First run of this stage (no earlier report).

## Findings (newest first)

### F1: pushed `fd4c24f..28b3976` (5 commits), no force push
- `c791d46` chess guardian run 1 (BUG-007 pinned), `7cdc067` BUG-007 fix, `f895b14` sim node budgets,
  `49b4cdf` project audit run 2, `28b3976` oversight follow-ups.
- Evidence: `git push` output `fd4c24f..28b3976  feature/photorealistic-renderer -> feature/photorealistic-renderer`.
  `git pull --rebase` before it: "Current branch feature/photorealistic-renderer is up to date" (no remote changes).
- This report is committed and pushed on top as a sixth commit.

### F2: PR #1 body updated (yes)
- `gh api -X PATCH repos/constantlods/townchess/pulls/1 -F body=@file` returned `updated_at 2026-10-05T02:15:56Z`,
  `draft true`, body 22,308 characters. Read back: starts with `## Summary`, ends with the Claude Code line.
- New section "Current state (pipeline run 1)": both test counts, chess guardian findings (BUG-007, sim budgets,
  51 games / 0 anomalies), visual judge scores (pass 27), the oversight audit's 8 open problems, screenshot links
  (31-main, 31-board-closeup, 31-opponent-closeup, 27-main, 22-reference-pass).
- Stale lines fixed: test count 446 -> 475, passes 00-06 -> 00-31, the simulator/Stockfish/MetaHuman "not yet done"
  lines, the "Requested next" list (now with status), pipeline and free-assets docs links.
- The PR stays a draft; nothing was merged and `main` was not touched.

### F3: branches left for the owner (nothing deleted)
- `origin/agents/stockfish-league`: merged into this branch, not deleted. Owner to decide.
- `origin/claude/horror-chess-prototype`: equal to `main` (per the audit). Owner to decide.
- `origin/agents/rules-audit-2`: merged earlier (`20fb5e8`); still on the remote.
- Local: three agent worktree branches (`worktree-agent-*`) are stale; not touched.

### F4: nothing blocked
- `gh pr edit` was not tried (known to fail on this repo, Projects classic); the API PATCH worked.

## Checks before pushing

| Check | Result |
|---|---|
| `TC_STOCKFISH=tools/.cache/stockfish/stockfish-linux-x86-64-universal npm test` | `Test Files 19 passed (19)`, `Tests 475 passed (475)` |
| `npm test` (no engine) | `Test Files 19 passed (19)`, `Tests 474 passed \| 1 skipped (475)` |
| Large files: `git diff --stat origin/feature/photorealistic-renderer..HEAD` | 10 text files (docs, `uciEngine.ts`, `uci.test.ts`, `simulate.ts`), +254/-88, no binaries |
| Secrets: diff grep for password/token/AUTH_/PRIVATE KEY/ssh keys | 3 hits, all audit prose describing the secrets check (`AUTH_PASSWORD` named as something searched for); no actual secret |

## Carried to the next run
- Merge commits authored `root@Fpc.pve2` (audit F8): set the git identity before the next merge.
- Screenshot growth (84 MB tracked): only kept passes should be committed (evidence rules).
