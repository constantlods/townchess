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
| Game start | `CREATE_AI_GAME {level, color, timeControl}` | Play the house engine through the core: the path UE5 offline play uses (`timeControl: 'untimed'` allowed). Always unrated, and limited to one active game per player |
| Draws | `CLAIM_DRAW {gameId, intended?}`; `drawPolicy` on `CREATE_AI_GAME` / `CREATE_PRIVATE` | FIDE claims, for games created with the `claim` policy (matchmade games use `automatic`) |
| Events | `state.eventSeq` | Act on `lastEvents` only once per sequence number |
| Moves for clients | `state.legalMoves` | UCI moves for the side to move. Clients highlight moves without any rules code. Public information: it's derivable from the FEN |
| Animation | `moveHistory[].effects` | Ordered physical effects (captures, every piece that moves, promotion swaps), so castling, en passant and promotion animate without rules knowledge |
| Results | `state.termination` | Precise reason, matching PGN `[Termination]` |
| Openings and events | `state.opening`, `state.inBook`, `state.lastEvents` | Openings and deterministic events for commentary and the analysis cart |
| Draw claims | `state.drawPolicy`, `state.claimableDraw` | Whether a claim is possible right now |
| Game start | `state.firstMoveDeadline` | Wall-clock deadline for the first move (the abort window) |
| Players | `PlayerPublic.rating: number \| null`, `ai: {level}` | Engine seats show **no rating**: the levels are not calibrated |

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
