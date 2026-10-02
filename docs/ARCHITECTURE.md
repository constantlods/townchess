# Architecture

```
            ┌──────────────────────── packages/shared ────────────────────────┐
            │ rules.ts (chess.js wrapper) · clock.ts · protocol.ts (zod) · types │
            └───────────────▲───────────────────────────────▲─────────────────┘
                            │                               │
   packages/server (authority)                    packages/client (browser, Three.js)
   index.ts  http + /ws                           game/   Session, LocalSession (vs AI), presenter
   hub.ts    routing, matchmaking, reconnect      game/   ai.worker.ts (alpha-beta, off main thread)
   room.ts   validates identity, seat, turn,      net/    NetClient / NetSession  ◄── WebSocket JSON ──► server
             ply, ownership, legality, clocks     scene/  world, camera, board, pieces, hands, opponent
   players.ts token identity (hashed), Elo        render/ procedural textures, SDF mesher, post
                                                  ui/ audio/
```

## Rules

- **Game logic never depends on rendering.**
  - `shared` and `server` import nothing from `client`.
  - The presenter turns authoritative state changes into animation, but animation never changes state.
- **The server is authoritative.**
  - Clients send requests: `MOVE`, `RESIGN`, `DRAW_OFFER` and so on.
  - The server answers `MOVE_ACCEPTED` or `MOVE_REJECTED`, and broadcasts `GAME_STATE_UPDATED`.
  - Clocks and results are computed only on the server.
- **The AI runs in a Web Worker**, so it cannot stall rendering.

## Planned rendering client (see RENDERING.md)

A UE5 client would replace `client/scene` and `client/render` only. It would speak the same protocol as `NetClient`.
Offline play against the AI would need either a port of the AI, or the server could host AI seats.

With Pixel Streaming:

- The browser becomes a video and input layer.
- The UE process renders on the RX 6650 XT, encodes H.264 in hardware, and sends it over WebRTC.
- The game server stays unchanged and separate from the renderer.
