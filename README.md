# townchess — Horror Chess

A first-person, physically staged chess game for the browser. You sit at a filthy institutional table under a
single industrial lamp, your own hands resting on the wood, across from a masked stranger. Every texture, mesh and
sound is generated procedurally in code — there are no third-party art or audio assets, and nothing is taken from
any existing game.

Build report: [docs/REPORT.md](docs/REPORT.md) · Session summary: [docs/SESSION_SUMMARY.md](docs/SESSION_SUMMARY.md) ·
Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Rendering / engine evaluation: [docs/RENDERING.md](docs/RENDERING.md) ·
Performance on the RX 6650 XT: [docs/PERFORMANCE.md](docs/PERFORMANCE.md)

> **Photorealistic rendering phase.** The procedural Three.js renderer is version 0. A UE5 benchmark scene now runs
> on the production GPU, an AMD RX 6650 XT, inside a Proxmox VM with the GPU passed through.
>
> - **Performance:** 64.5 fps at 1440p HIGH, with TSR from 67% internal resolution, using 3.1 GB of VRAM.
> - **Details:** see RENDERING.md and PERFORMANCE.md.
> - **Game code:** not migrated yet. The browser game below is still the playable build.

![Gameplay](docs/screenshots/gameplay-1920x1080.jpg)

## Run it

Requires Node 20+.

```bash
npm install
npm run dev            # client → http://localhost:5173   (Play vs AI works with only this)
npm run dev:server     # game server → ws://localhost:8787/ws (needed for Casual / Rated / Private)
```

The Vite dev server proxies `/ws` to the game server, so open the client URL in two browsers to play each other.

Production (single process serving the built client and the WebSocket endpoint):

```bash
npm run start          # builds the client, then serves it + /ws on PORT (default 8787)
```

UE5 benchmark (render VM; see `ue5/`):

```bash
python3 ue5/tools/fetch_polyhaven.py ~/assets/polyhaven 2k   # CC0 models/textures
ue5/tools/build_scene.sh                                     # rebuild /Game/Bench/L_Bench headless
ue5/tools/run_bench.sh 2560x1440 high 67                     # one run: CSV + telemetry + screenshot
ue5/tools/bench_matrix.sh && python3 ue5/tools/summarize_bench.py <run dirs>
```

Checks:

```bash
npm run typecheck
npm test               # rules, clock, protocol, server authority (17 tests)
node tools/gpubench.mjs 2560x1440   # FPS / frame time / 1% lows on the real GPU (client on :5199)
npm run e2e:online     # two headless browsers play through the real server (server + client must be running)
```

## What you can do

- **Play vs AI** — alpha-beta engine in a Web Worker, three strengths (Novice / Patient / Warden).
- **Casual / Rated / Private match** — authoritative WebSocket server; private tables use codes like `GAME-8F3A21`.
- Select a piece, see legal-move marks, and watch your hand reach, grip, lift, carry, place, release and return.
  Captures take the victim with the tucked fingers and set it down beside the board.
- Castling, en passant, promotion picker, check accent, clocks with increments, draw offers, resignation, rematch.
- Game over: the board stays, the camera slowly settles on the final position, ambience falls away, the losing king
  tips over, then small text: `CHECKMATE` → `You Win / You Lose` → Rematch / Return to Lobby.
- **Hand customization** (Hands / Gloves / Sleeves / Accessories) with rendered previews; your first-person hands
  update immediately.
- **Board environments**: Institutional Oak, Basement Table, Examination Room, Abandoned Office, Prison Cell, Old Hotel
  (thumbnails are real renders of each room).
- **Settings / accessibility**: reduced motion, reduced camera movement, reduced horror effects, increased piece
  contrast, larger board, simplified environment, SFX / ambience / music volume, animation mode
  (cinematic / standard / competitive = instant), graphics quality, depth of field, move hints.

## Architecture

```
packages/
  shared/   chess.js rules wrapper, chess clock, zod-validated protocol, domain types  (used by client AND server)
  server/   http + ws: PlayerStore (token identity, Elo), GameRoom (authority), Hub (routing, matchmaking, reconnect)
  client/
    render/   procedural PBR textures, SDF modelling + surface-nets mesher, worker asset pipeline, post-processing
    scene/    world, camera rig, board, pieces, hands (17-bone IK arms), opponent, environments, move choreography
    game/     Session interface, LocalSession (vs AI), presenter (input, animation queue, game-over), AI engine
    net/      NetClient / NetSession (server-authoritative games, auto-reconnect)
    ui/       HUD, lobby, customization, environment picker, settings (institutional styling)
    audio/    Web Audio synthesis: hum, air, pipes, creaks, footsteps, metal; piece and clock sounds; drone
tools/      headless screenshot helper (visual iteration) and the online end-to-end script
```

### Server authority / anti-cheat foundation

The client only sends requests (`MOVE`, `RESIGN`, `DRAW_OFFER`, …). The server verifies identity (bearer token,
stored hashed), seat, turn, ply (stale moves), piece ownership, legality and the clock, then answers
`MOVE_ACCEPTED` / `MOVE_REJECTED` and broadcasts `GAME_STATE_UPDATED`. Clocks run on the server and flag on a
timer; results and ratings are computed only on the server. Unknown or malformed messages are rejected by schema,
and each socket is rate limited. A dropped player keeps their seat for 60 s (their clock keeps running); reconnecting
with the same token rejoins and receives the full authoritative state.

### Asset pipeline

Textures and meshes are generated from code. A dry-run pass discovers what a scene needs, the work runs in parallel
Web Workers, and results are cached in IndexedDB so later visits load quickly. Graphics quality scales texture
resolution, shadow maps, ambient occlusion, depth of field and pixel ratio.

## Known limitations (honest list)

- Hands, opponent and props are procedural (signed-distance modelling), not scanned assets. They are lit and shaded
  physically, but they will not match photographic or "DLSS-realistic" fidelity. The asset pipeline is the place to
  drop in scanned meshes/textures later.
- First load generates all materials (several seconds on a desktop, longer on phones); repeat loads use the cache.
- Player data persists to a JSON file (`server-data/players.json`). There is no database and no account system
  beyond anonymous tokens yet.
- Rated pairing uses plain Elo (K = 32). No anti-engine detection; the server only guarantees legal play and fair clocks.
- No voice chat, spectating or move list / PGN export yet.
