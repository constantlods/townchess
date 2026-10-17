# Opening names: source and licence

- **Source:** https://github.com/lichess-org/chess-openings, commit `c67912be581f0793dbaa776be5ccf111e01f88d9`
  (2026-09-20).
- **Licence:** CC0 1.0 Universal (public domain dedication). See `COPYING.txt`.
- **Files:** `a.tsv`–`e.tsv`, with columns `eco`, `name` and `pgn`.

`tools/build-openings.mjs` turns these into `packages/shared/src/openings/book.json`, a position-keyed index. To
update the data, replace the TSVs and re-run `npm run build:openings`.
