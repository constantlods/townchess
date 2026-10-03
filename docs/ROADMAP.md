# TownChess Master Roadmap

Written 2026-10-03 from a full audit of `feature/photorealistic-renderer`, then revised the same day after an
adversarial review by a critique agent. It replaces the earlier phase list from the rendering spec. Each milestone
lists its scope, how we'll know it's done, and what is deliberately not in it.

**Status:** Milestone 1 (core foundation) is complete; see §5. Milestone 2 is gated on a decision by the owner (§4).

## 1. Audit: what actually exists

### Complete and reusable (keep)

| System | Where | Evidence |
| --- | --- | --- |
| Rules wrapper over chess.js (legal moves, check/mate/stalemate, castling, en passant, promotion, insufficient material, threefold, 50-move) | `packages/shared/src/rules.ts` | Unit tests; used by server and client |
| Deterministic chess clock (time is injected, increments) | `packages/shared/src/clock.ts` | Unit tests |
| zod-validated WebSocket protocol | `packages/shared/src/protocol.ts` | Malformed-message tests |
| Authoritative server: identity tokens (stored hashed), seat/turn/ply/ownership/legality checks, server clocks with flag timer, draw offers, resignation, rematch with colours swapped, reconnect grace period, matchmaking, private tables, Elo, rate limiting | `packages/server/src/*` | 10 server tests, plus two-browser and offline end-to-end scripts. **The end-to-end scripts are run by hand, not in CI** |
| `Session` seam in the browser: the presenter only talks to a session (local or network) | `packages/client/src/game/session.ts` | Two implementations |
| Browser prototype (procedural renderer, IK hands, choreography, HUD, lobby, customisation, procedural audio) | `packages/client` | Playable; gameplay reference and lightweight client |
| UE5 benchmark project and tooling (VM 131, RADV, TSR, Lumen) | `ue5/` | PERFORMANCE.md |

### Partial or incorrect (fix in the core)

- **FIDE draw rules.**
  - Threefold repetition and the 50-move rule end the game automatically, with no claim step.
  - Fivefold repetition and the 75-move rule are not modelled.
  - Dead positions beyond basic insufficient material are not detected.
- **Timeout against insufficient material is wrong for FIDE 6.9.**
  - `hasMatingMaterial` only looks at the side with time left.
  - Example: K+N against K+P is a **loss** for the side whose flag fell, because a helpmate exists. Today it is
    scored as a draw.
- **Game flow is written twice.** Finish, timeout and draw handling exist in both `GameRoom` (server) and
  `LocalSession` (browser offline).
- **The AI only runs in the browser** (`client/src/game/ai.ts` in a Web Worker). A UE5 client or the server cannot
  host a CPU opponent.
- **No game record.** There is no PGN export or import, and finished games are dropped from memory after 10 minutes.
- **No spectators.** `broadcast` only reaches the two seats.
- **Promotion defaults silently to a queen** when the client omits the piece.

### Placeholder (replace later through clean seams)

- Procedural hands, opponent and props in the browser.
- The template mannequin and template VR hands in the UE5 benchmark.
- Opponent "personality". The only thing behind it is three AI levels: Novice, Patient and Warden. **Their displayed
  "ratings" (850/1187/1550) were invented. Removed in Milestone 1; no Elo is claimed until calibration.**
- **The UE5 benchmark's 64.5 fps is a feasibility number, not a budget.** It was measured on Linux/Vulkan rather than
  the Windows/DX12 target, with 115 actors, template mannequins (no MetaHuman skin, hair or cloth) and one mid-range
  GPU. Scaling to lower-tier GPUs is unmeasured, and there is no minimum spec yet.

### Missing entirely

- Opening recognition.
- Game understanding and events.
- An engine (Stockfish) for analysis.
- Commentary.
- The coach.
- The agent lab.
- The analysis cart.
- The character system.
- A **UE5 game client**: zero gameplay code. The benchmark is a static scene.
- Windows packaging.
- Persistence beyond `players.json`.

## 2. Architecture decision: one game core, every client speaks the protocol

```
   UE5 native client ─┐                          ┌─ ChessRules (chess.js)
   Browser client ────┼── WebSocket protocol ── TownChess Core ─┼─ GameCore (flow, clocks, FIDE draws)
   Stream/agents ─────┘    (zod-validated)        (Node, TS)     ├─ Openings (Lichess CC0 data)
                                                                 ├─ GameEvents (deterministic)
                                                                 ├─ AI seats (worker threads)
                                                                 └─ later: Stockfish, commentary selection, coach, agents
```

- **UE5 is a presentation and input client and never evaluates chess rules.** It receives the FEN, the legal moves
  for the side to move, history, opening and events from the core. It sends requests.
- **Offline play in UE5 goes through a local instance of the same core** (a sidecar process on localhost), so the
  rules exist exactly once. The rejected alternative was porting the rules to C++: it duplicates the most
  correctness-critical code in the project.
  - Cost of this choice: shipping a Node runtime with the game (Node single-executable application, about 50–90 MB).
- **The browser keeps its in-tab offline mode**, but `LocalSession` and `GameRoom` will share one `GameCore` state
  machine, and the web worker will import the same engine package the server uses.

**Sidecar lifecycle requirements.** These were raised by the critique and must be proven in Milestone 2, not
Milestone 7:
- Launch on an ephemeral port reported on stdout. Never use a fixed port.
- Use a per-launch secret token, so other local processes cannot drive the game.
- Tie the sidecar's lifetime to the game's: on Windows, a Job Object with `KILL_ON_JOB_CLOSE`, so a UE crash never
  leaves an orphaned core.
- If the core crashes mid-game, restart it and resume from the move record.
- Test signing and antivirus behaviour of a Node single-executable on Windows.
- Merge logs into UE's log.
- There is no animation latency problem: localhost round-trips take under 1 ms. UE never infers rules, because the
  core sends per-move `effects`.

**Alternatives considered, in case the sidecar fails on Windows (antivirus, signing):**
- (a) The same TypeScript core running inside UE, on an embedded JS runtime (for example Puerts/V8, or QuickJS). There
  is no process and no port.
- (b) A C++ move generator used only for offline play, checked against the TS core by differential tests: perft plus
  the 123-case FIDE fixture file as a shared oracle.

Option (a) is the fallback.
- **Engines calculate, LLMs explain.**
  - Legality, clocks, state and events are deterministic code.
  - Evaluation comes from an engine.
  - LLMs only ever consume engine output, for coaching, critique and dialogue.

## 3. Technical risks (highest first)

1. **Windows packaging needs a Windows build host.** UE cannot cross-compile Windows games from Linux, and the
   primary target is Windows. This needs a Windows VM on the same GPU, or a separate Windows machine, before
   Milestone 7. The owner has to decide.
2. **Asset production capacity.** Photoreal hands, an original masked character and environments need art. The
   plan:
   - MetaHuman as the base: free, but licensed for UE only, and it needs a Fab/Epic sign-in inside the editor.
   - CC0 scans.
   - A few hero props made in-house: board, pieces, mask.

   This is the slowest-moving risk.

   To verify: MetaHuman's current licence terms (they may have changed after UE 5.6, so check rather than assume),
   and whether MetaHuman Creator and Fab work in the Linux editor.
3. ~~**Native C++ build on the Linux VM.**~~ **Retired 2026-10-03.** A spike module using `WebSockets`, `Json` and
   `JsonUtilities` compiled and linked with UBT in VM 131 in 47 s, peaking at 2.1 GB of memory. Full editor builds
   with more modules will need more; watch memory.
4. **Animation stays in sync with authoritative state.** Moves must never be shown before the server accepts them,
   and a rejection must play back cleanly.
5. **Stockfish is GPL-3.** That's fine as a separate process; distributing it requires shipping its licence and
   offering the source. It must not be linked into the UE binary.
6. **Pixel Streaming on Linux has no AMD hardware encoder** (RENDERING.md). This is deferred by design.
7. **Hardware ray tracing on Linux needs Mesa 26.2 or newer.** It is optional by design: software Lumen is the
   default.

## 4. Milestones (in order) and why this order

The rule is to build what everything else depends on first. Every later feature (UE client, analysis cart,
commentary, coach, agents) consumes the same few things: correct game state, a move record, the opening, and an
event stream. So the core comes before any UE gameplay, and the first UE milestone is deliberately thin.

| # | Milestone | Scope | Definition of done |
| --- | --- | --- | --- |
| 0 | **Done**: prototype and renderer feasibility | Browser game; UE5 benchmark (1440p HIGH, TSR at 67%, 64.5 fps) | — |
| **1** | **Core foundation** (current) | `GameCore` shared by server and browser offline; FIDE-complete draws and timeout rules; PGN; opening recognition (Lichess CC0); deterministic `GameEvents`; engine package shared by worker and server; server-hosted AI games; protocol v2 (legal moves, opening and events in state) | All rules cases from the FIDE fixture suite pass; the browser still plays against the AI and online; e2e passes; docs `CHESS.md`, `NETWORKING.md` |
| **gate** | **Windows host decision (owner)** | A second machine, or more RAM plus a Windows VM sharing the GPU in turns. Both VMs can't use the single passed-through GPU at once, and the host has 15 GiB of RAM. Needed before the Milestone 2 packaged-Windows test | Decision recorded |
| 2 | **UE5 playable slice** (thin) | `ue5/TownChess` C++ project: WebSocket protocol client, board mirror from the FEN, piece actors, click-to-select with legal-move markers, White and Black seat cameras, promotion picker, game end. Uses benchmark-quality art | A full game against the server-hosted AI and against a browser opponent, from either seat; reconnect works; **a packaged Win64 build launches the core sidecar, plays a full CPU game, and survives killing either process** |
| 2b | **Art and feel spike** (alongside 2) | One hand, one piece, one mask prototype under Lumen, on Windows. Pick the art sources (outsourcing or not). Minimum-spec GPU target | Screenshots and per-element ms costs; an art capacity plan |
| 3 | **Physical interaction** | Hand rig abstraction (placeholder → final), IK reach/grip/lift/carry/place/release, captures set aside, piece and table sounds, animation gated on server acceptance | Every move type (castling, en passant, promotion, capture) animates correctly from both seats; a rejected move plays back |
| 4 | **Vertical slice: "This is TownChess"** | One original character ("The Annotator", `docs/CHARACTERS.md`) with idle, think and react behaviour; one environment art pass; analysis cart v1 (a physical object: move list, opening, ECO); commentary v1 (data-driven lines on `GameEvents`, cooldowns, subtitles); LOW/MED/HIGH/CINEMATIC presets; **fair-play rules for the cart (no engine evaluation in online rated games)** | A cold playtest of one full game "feels like TownChess"; performance measured against the baseline |
| 5 | **Chess intelligence** | Stockfish service (UCI, server side); move classification (blunder/mistake/inaccuracy/best and similar, from evaluation swings); post-game review; evaluation on the cart; CPU levels using engine skill settings (labels not claimed as Elo without calibration) | Classifications validated on a labelled game set; the cart and commentary consume them |
| 6 | **Online in UE** | Matchmaking, private tables, spectators (with no analysis leakage), persistent games database, replay and PGN history | UE against UE and UE against browser online; spectator view; replay of a stored game |
| 7 | **Native Windows release pipeline** | Windows build host; Development/Test/Shipping builds; bundled core sidecar and Stockfish with licences; logging, crash reporting, settings and save data; versioning | Installable Windows build passes a smoke test on a second machine |
| 8 | **Coach and agent lab** | Coach personalities on engine analysis plus an LLM explanation layer; agent self-play at scale; reports by role (tactics, openings, strategy, endgame, time) | Coach review of a real game is accurate against engine truth; the lab produces reproducible batch reports |
| 9 | **Content expansion** | More characters and environments, horror tension systems, intensity options | Per-content budgets met |
| 10 | **Optional streaming and cloud** | Pixel Streaming (Windows AMF, or the Linux VA-API path), cloud hosting | Measured latency, bitrate and cost |

**Why the UE slice (2) comes before photorealism and interaction (3–4).** The riskiest unknowns are C++ in the VM,
protocol integration, and keeping presentation in sync with the authority. Art built on an unproven client gets
thrown away.

**Why Stockfish (5) comes after the vertical slice.** The slice needs openings and events, which are deterministic,
but not engine evaluations. That keeps the slice independent of GPL packaging questions.

**Why Windows packaging is at 7, not later.** The game has to stay shippable once the slice exists. Waiting longer
risks Windows-only surprises piling up.

## 5. Milestone 1: core foundation (complete, 2026-10-03)

| Item | Status | Evidence |
| --- | --- | --- |
| `GameCore`: one state machine for the server's `GameRoom` and the browser's `LocalSession` | Done | `packages/shared/src/game.ts`; duplicated game flow removed from both |
| FIDE draws: fivefold/75 automatic; threefold/50 `automatic` (default) or `claim`, including a claim with an intended move | Done | `core.test.ts`; FIDE fixtures |
| FIDE 6.9 timeout and abandonment by material class (exclusions backed by brute-force enumeration) | Done | `material.ts`, fixtures |
| Dead position by material; ending detected from a custom start FEN | Done | |
| Dead positions from a locked pawn structure | **Known limitation** | Three fixture cases pinned as `KNOWN_LIMITATIONS`; see `docs/CHESS.md` |
| Explicit promotion (no silent queen) | Done | Server and core tests |
| Monotonic server clock; first-move window and abort | Done | Server tests |
| Termination taxonomy (14 values) | Done | Protocol v2 |
| Per-move `effects` (castling rook, en passant victim, promotion swap) | Done | Golden examples |
| Openings: Lichess CC0, position-keyed, transpositions | Done | 3,815 positions; tests |
| Deterministic `GameEvents` | Done | `events.ts`; tests |
| PGN export and import | Done | Round-trip test |
| `@hc/engine` package (seedable, node-limited); server `AiPool` on worker threads; `CREATE_AI_GAME` | Done | A full AI game over WebSocket in the server tests |
| Protocol v2 + JSON Schema + 11 golden examples; every server message checked against the schema in tests | Done | `docs/protocol/` |
| Security quick wins: per-IP socket and identity limits, AI game quota, no error leakage, Origin allow-list, proxy-aware IPs | Done | `docs/NETWORKING.md` |
| Engine "ratings" removed (uncalibrated) | Done | `docs/AI.md` |
| UE C++ build spike | Done | Risk 3 retired |

**Tests: 290 automated tests**, run three times in a row with no failures:
- 123 FIDE cases against chess.js and the same 123 against `GameCore`;
- core, shared and server tests.

The two-browser online test and the offline AI test pass (run by hand).

Next: Milestone 2, after the Windows host decision.

## 6. Explicitly not built yet (project-wide)

Pixel Streaming and cloud; multiple characters or environments before one works; an LLM coach before engine
analysis exists; the agent lab before a game record and engine service exist; Steam, Epic or mobile; installers; a
large asset library; thousands of commentary lines before event detection is proven.
