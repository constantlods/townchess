# TownChess — Horror Chess

A first-person, physically staged horror chess game. You sit at a filthy institutional table under a single
industrial lamp, your own hands resting on the wood, across from a masked stranger.

TownChess is being built as a **native Unreal Engine 5 game** (`ue5/TownChess`, C++), targeting Windows. It is in
development and has no release yet. All chess rules live in one TypeScript core (`packages/shared`, `packages/server`).
The UE client contains no rules: it talks protocol v2 to that core, either to a game server or to a private local core
(the sidecar) for offline play. The original **browser client** (`packages/client`, procedural Three.js) still plays
full games. It is now the secondary client and the gameplay reference.

**Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)** · Chess rules: [docs/CHESS.md](docs/CHESS.md) ·
Protocol: [docs/NETWORKING.md](docs/NETWORKING.md) · Engines/AI: [docs/AI.md](docs/AI.md) ·
Characters: [docs/CHARACTERS.md](docs/CHARACTERS.md) ·
Build report: [docs/REPORT.md](docs/REPORT.md) · Session summary: [docs/SESSION_SUMMARY.md](docs/SESSION_SUMMARY.md) ·
Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Rendering / engine evaluation: [docs/RENDERING.md](docs/RENDERING.md) ·
Performance on the RX 6650 XT: [docs/PERFORMANCE.md](docs/PERFORMANCE.md) · Known limitations: [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)

> **Status (2026-10-03).** Milestone 1 (core foundation) is complete. Milestone 2 (UE5 playable client) is in progress:
>
> - **Done on Linux:** the UE client plays full games against the core. That covers the server-hosted engine, a browser
>   opponent through one server, the special rules, clocks and flag fall, and kill/relaunch/rejoin. Evidence is in
>   ROADMAP.md §5b.
> - **Pending:** a packaged Win64 build on the Windows dev PC, and checking real mouse picking and the on-screen HUD,
>   which can't be verified headless.
> - **Rendering feasibility:** the UE5 benchmark scene ran at 64.5 fps at 1440p HIGH (TSR from 67%) on an RX 6650 XT
>   (Linux/Vulkan). That is a feasibility number, not a budget. The UE client still uses benchmark-quality art.

![Gameplay](docs/screenshots/gameplay-1920x1080.jpg)

## Run it

Browser client and core. Requires Node 20+.

```bash
npm install
npm run dev            # client → http://localhost:5173   (Play vs AI works with only this)
npm run dev:server     # game server → ws://localhost:8787/ws (needed for Casual / Rated / Private and CREATE_AI_GAME)
```

The Vite dev server proxies `/ws` to the game server, so open the client URL in two browsers to play each other.

Production (single process serving the built client and the WebSocket endpoint):

```bash
npm run start          # builds the client, then serves it + /ws on PORT (default 8787)
```

UE5 client (`ue5/TownChess`; needs Node 22+ and a repo checkout for the dev-mode local core). Windows build, content
and packaging scripts are in `ue5/tools/win/` (`build.ps1`, `setup_content.ps1`, `package.ps1`); the packaged
Windows build has not been verified yet.

```bash
npm ci && npm run bundle:core                                # core bundle for packaged builds (verified on stock Node)
# build TownChessEditor with UBT, build the level (ue5/TownChess/Scripts/build_level.py), then run:
UnrealEditor ue5/TownChess/TownChess.uproject -game          # offline: starts the local core, menu → play The Annotator
UnrealEditor ue5/TownChess/TownChess.uproject -game -tcserver=ws://host:8787/ws   # online
ue5/tools/run_client.sh cpu <out> -tcauto=cpu:novice:w:untimed                    # automated game + checks
TC_VM=user@host TC_WEB=http://host:8787 node tools/e2e-ue-browser.mjs special|mate|stalemate|draw                          # UE vs browser via one server
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
npm test               # 473 tests in 19 files: 123 FIDE fixture cases (vs chess.js and vs GameCore), core, protocol,
                       # server, sidecar, engine, UCI league (1 test needs TC_STOCKFISH), learning
npm run e2e:offline    # browser vs the in-tab engine (client must be served, e.g. npm run start)
node tools/gpubench.mjs 2560x1440   # FPS / frame time / 1% lows on the real GPU (client on :5199)
npm run e2e:online     # two headless browsers play through the real server (server + client must be running)
```

## What you can do (browser client)

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
  shared/   rules wrapper (chess.js), GameCore (game flow, FIDE draws, 6.9 timeouts), clock, openings (Lichess CC0),
            deterministic events, PGN, zod protocol v2 (+ JSON Schema in docs/protocol)   (used by every client AND server)
  engine/   house alpha-beta engine (seedable, node-limited), shared by the browser worker and the server pool
  learning/ learning foundation: interfaces and pure, deterministic functions only; no ML (docs/LEARNING.md)
  server/   http + ws: PlayerStore (token identity, Elo), GameRoom (seats/timers → GameCore), Hub (routing,
            matchmaking, reconnect, abuse limits, AI games), AiPool (engine on worker threads);
            sidecar.ts = the local core the UE client launches for offline play (bundled by npm run bundle:core)
  client/   browser client (secondary)
    render/   procedural PBR textures, SDF modelling + surface-nets mesher, worker asset pipeline, post-processing
    scene/    world, camera rig, board, pieces, hands (17-bone IK arms), opponent, environments, move choreography
    game/     Session interface, LocalSession (vs AI, on GameCore), presenter (input, animation queue, game-over)
    net/      NetClient / NetSession (server-authoritative games, auto-reconnect)
    ui/       HUD, lobby, customization, environment picker, settings (institutional styling)
    audio/    Web Audio synthesis: hum, air, pipes, creaks, footsteps, metal; piece and clock sounds; drone
ue5/
  TownChess/       native UE5 C++ client: UTCCoreClient (protocol v2, identity, reconnect), UTCLocalCore (sidecar
                   launcher), ATCBoard (board from FEN, animates accepted moves), seat cameras, HUD; Scripts/ (level
                   builder, in-game test driver)
  TownChessBench/  UE5 rendering benchmark scene
  tools/           Linux run/test/benchmark scripts; win/ Windows build and packaging scripts
tools/      screenshot and GPU benchmark helpers, end-to-end scripts (online, offline, UE ↔ browser), core bundler
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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

## Known limitations of the browser client (honest list)

- Hands, opponent and props are procedural (signed-distance modelling), not scanned assets. They are lit and shaded
  physically, but they will not match photographic or "DLSS-realistic" fidelity. The asset pipeline is the place to
  drop in scanned meshes/textures later.
- First load generates all materials (several seconds on a desktop, longer on phones); repeat loads use the cache.
- Player data persists to a JSON file (`server-data/players.json`). There is no database and no account system
  beyond anonymous tokens yet.
- Rated pairing uses plain Elo (K = 32). No anti-engine detection; the server only guarantees legal play and fair clocks.
- No voice chat or spectating. PGN export/import exists in the core but not in the browser UI.
- The full registry is [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).
