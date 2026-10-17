# Networking and protocol

## Topology

```
browser client ─┐
UE5 client ─────┼── WebSocket (JSON, /ws) ── TownChess core server (Node, packages/server)
agents/tools ───┘                               ├─ Hub: identity, limits, matchmaking, routing, AI scheduling
                                                ├─ GameRoom: seats, timers, ratings → delegates every decision to GameCore
                                                └─ AiPool: engine searches on worker threads
```

**The server is authoritative.** Clients send requests. The server validates:
- the message schema;
- identity (a bearer token, stored only as a sha256 hash);
- the seat, the turn and the ply (stale moves are rejected);
- piece ownership, legality and promotion choice;
- the clocks.

It then answers `MOVE_ACCEPTED` / `MOVE_REJECTED` and broadcasts `GAME_STATE_UPDATED`. Results and ratings are only
ever computed on the server.

## Protocol v2

The machine-readable contract is in `docs/protocol/`, regenerated with `npm run build:schema`:
- `client-messages.schema.json` and `server-messages.schema.json` (JSON Schema, exported from the zod definitions);
- `examples/*.json`: golden messages produced by the real `GameCore` and validated against the schema. Cases include
  castling, en passant, capture with promotion, checkmate and rejection.

The server tests validate **every message their WebSocket test clients receive** against `ServerMessageSchema`.
Room-level tests use stub transports, so their messages aren't schema-checked at runtime. All room and hub messages
are typed as `ServerMessage` at compile time, and a compile-time check keeps the schema and the TypeScript
`GameStateDTO` identical.

New in v2:

| Area | Field or message | Purpose |
| --- | --- | --- |
| Handshake | `WELCOME.protocolVersion` | Clients refuse versions they don't know |
| Game start | `CREATE_AI_GAME {level, color, timeControl}` | Play an engine through the core: the path UE5 offline play uses (`timeControl: 'untimed'` allowed). `level` is a house level (`novice`, `patient`, `warden`) or a league level (`sf1350`, `sf1600`, `sf1900`, `sf2200`, `sf2500`, `sfmax`: Stockfish over UCI, see [AI.md](AI.md)). A league level the core did not offer gets `ERROR engine_unavailable`. Always unrated, and limited to one active game per player |
| Engine levels | `WELCOME.aiLevels: [{id, label, engine: 'house'\|'uci', uciElo: number\|null}]` | The levels this core can play right now, in menu order. Always the three house levels; the six league levels only when a UCI engine was found. Build the AI menu from this list. Optional in the schema: a core older than this field sends none, so treat absence as the three house levels |
| Draws | `CLAIM_DRAW {gameId, intended?}`; `drawPolicy` on `CREATE_AI_GAME` / `CREATE_PRIVATE` | FIDE claims, for games created with the `claim` policy (matchmade games use `automatic`) |
| Events | `state.eventSeq` | Act on `lastEvents` only once per sequence number |
| Moves for clients | `state.legalMoves` | UCI moves for the side to move. Clients highlight moves without any rules code. Public information: it's derivable from the FEN |
| Animation | `moveHistory[].effects` | Ordered physical effects (captures, every piece that moves, promotion swaps), so castling, en passant and promotion animate without rules knowledge |
| Results | `state.termination` | Precise reason, matching PGN `[Termination]` |
| Openings and events | `state.opening`, `state.inBook`, `state.lastEvents` | Openings and deterministic events for commentary and the analysis cart |
| Draw claims | `state.drawPolicy`, `state.claimableDraw` | Whether a claim is possible right now |
| Game start | `state.firstMoveDeadline` | Wall-clock deadline for the first move (the abort window) |
| Clocks | `state.clockRunning` | Whose clock is running, or null. Clients extrapolate only this clock |
| Players | `PlayerPublic.rating: number \| null`, `ai: {level}` | Engine seats show **no rating**: the levels are not calibrated |

`WELCOME.aiLevels` was added after v2 shipped. It is additive (an optional field on an existing message), so
`PROTOCOL_VERSION` stays 2: clients that ignore unknown fields keep working, and clients that read it can offer
exactly what the core supports. This was chosen over a new capability message because WELCOME is already the one
message every client waits for, and the list depends on the core's machine (whether an engine binary exists), not on
the protocol version. Engine seats keep `rating: null` for every level; a league seat's `ai.level` is its id
(`sf1600`), whose label comes from `aiLevels`.

## Local core (offline play in the UE5 client)

The native client never contains chess rules. For offline games it launches a private instance of the same core,
`packages/server/src/sidecar.ts`, and talks protocol v2 to it.

| Requirement | How |
| --- | --- |
| Local only | Binds `127.0.0.1` |
| No fixed port | Port 0. The core prints one line, `TOWNCHESS_CORE_READY {"port":N,"pid":P,"protocolVersion":2}`, on stdout; all other logging goes to stderr |
| Per-launch secret | `UTCLocalCore` generates 64 random hex characters and writes them as the **first line on the child's stdin**, so they never appear in an environment block or on a command line. Every WebSocket must present the secret as `x-townchess-secret` (or `?secret=`); the core rejects anything else before the upgrade completes. Tools and tests may use `TOWNCHESS_CORE_SECRET` instead; the core removes it from its own environment |
| No orphans | The core exits as soon as its stdin closes. The client holds the write end of that pipe, so any client death (crash, kill, normal quit) closes it. On Windows the core is also placed in a Job Object with `KILL_ON_JOB_CLOSE` |
| Crash recovery | Unfinished games are journaled to `<Saved>/TownChess/core/journal/<id>.json` after every change, every 5 s during play, and on clean shutdown (`--data <dir>` sets the location). Each write is a temp file, fsync, then rename, with the rename retried on Windows `EPERM`/`EBUSY`. A restarted core replays each record through `GameCore` validation. Unrestorable records are moved to `journal/corrupt/` |
| Time while closed | **Offline games pause while the game is closed.** A clean quit keeps all thinking time used so far; a crash refunds at most the last ~5 s. A game saved before both first moves comes back still waiting for them: no clock runs and a fresh first-move window starts |
| Supervision | The client restarts a core that exits unexpectedly. After 5 failures within 5 s of launch it gives up and logs an error; the failure count resets once a core has stayed up for 60 s. A failed launch is retried every 2 s |
| Correlated logs | Everything the core prints is forwarded into the client log as `LogTownChessCore` |
| Paths | Highest precedence first: `-tccorenode=` / `-tccorescript=` / `-tccoreargs=` on the command line, then `TOWNCHESS_NODE` / `TOWNCHESS_CORE_SCRIPT`, then (packaged builds) the bundled runtime and core in `Content/TownChessCore`, then `NodePath` / `NodeArgs` / `ScriptPath` in `DefaultGame.ini`. Development builds run the TypeScript through the repo's tsx loader. `@PROJECTDIRURL@` expands to the project directory as a percent-encoded `file://` URL, because UE's ini parser strips braces and Node needs file URLs for absolute `--import` paths on Windows |

Tests:
- `packages/server/test/sidecar.test.ts` covers the secret, a crash plus journal resume, stdin-close exit, and
  league-engine discovery in `<data>/engines/` (offered in WELCOME, played, sent `quit` on exit).
- `ue5/tools/reconnect_test.sh` covers the same through the real UE client.

## Time

- **Clocks.** Game clocks run on `performance.now()` (monotonic). `clockSampledAt` and `firstMoveDeadline` are
  wall-clock (`Date.now()`) values, for display only.
- **Server timers.** The server arms a flag timer for the side to move and an abort timer during the first-move window.

## Abuse limits and security

| Limit | Value | Where |
| --- | --- | --- |
| Messages per connection | 40 per 5 s; excess messages are dropped with `ERROR rate` | `Hub.onConnection` |
| Message size | 4 KB | WebSocket `maxPayload` |
| Concurrent sockets per IP | 20 | `LIMITS.socketsPerIp` |
| New identities per IP | 10 per minute | `LIMITS.newIdentitiesPerIpPerMinute` |
| Active games per player (human or AI) | 1 | `activeGame` map |
| Active engine games per IP | 3 | `LIMITS.aiGamesPerIp` |
| Engine queue (global) | 64 pending searches; then `ERROR busy` on `CREATE_AI_GAME` | `LIMITS.aiQueueMax` |
| Engine searches | Worker pool, at most min(4, cores − 1) threads, queued. A failed search is retried once, then a legal move is played so the human never waits forever | `AiPool`, `Hub.aiToMove` |
| League engine processes | At most 4 (one per game in progress); then `ERROR busy` on `CREATE_AI_GAME` with a league level. Any engine failure falls back to the house engine for that move | `UciLeague.maxEngines` |
| Time-control keys | Own keys of `TIME_CONTROLS` only (`toString`/`__proto__` are rejected) | `timeControlOf` |

Further protections:
- **Error details** are logged on the server only. Clients get `ERROR server: internal error`.
- **Origin allow-list:** set `HC_ALLOWED_ORIGINS=https://a,https://b`. Browsers must then match; native clients send
  no Origin and are allowed.
- **Behind a reverse proxy:** set `HC_TRUST_PROXY=1` so per-IP limits use the **rightmost** `X-Forwarded-For` entry,
  the one our proxy appended. Entries further left come from the client and can be spoofed.
- **TLS** is terminated at the reverse proxy (Caddy, nginx and similar). The Node server speaks plain `ws://` and must
  not be exposed directly to the internet.

## Not done yet (tracked in the roadmap)

- **No spectators.** They need a broadcast delay and no analysis leakage (Milestone 6).
- **Weak identity.** Identities are anonymous tokens and usernames aren't unique: anyone can pick any name. Accounts
  come in Milestone 6.
- **Persistence** is a JSON file for players only. Finished games are not stored yet (Milestone 6).
- **Full history in every update.** Each `GAME_STATE_UPDATED` carries the whole move history, which is O(n²) over a
  game. Fine for chess-length games; deltas can come later if it shows up in measurements.
- **No lag compensation** for flag fall.
