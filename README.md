# townchess — Horror Chess

A first-person, physically staged chess game in the browser. You sit at a filthy institutional table under a single
lamp, your own hands resting on the wood, across from a masked opponent. All art (textures, meshes, sound) is
generated procedurally and is original.

> Status: **work in progress — Phase 1 (single-player visual prototype)**. See "Progress" below.

## Run

```bash
npm install
npm run dev          # client on http://localhost:5173
```

Requires Node 20+. Developed against Chrome; any WebGL2 browser should work.

## Layout

```
packages/
  shared/   chess rules wrapper (chess.js), clock, protocol schemas (zod), domain types
  client/   Vite + three.js renderer, scene, animation, UI, audio
  server/   authoritative WebSocket game server (Phase 2)
tools/      headless screenshot helper used for visual iteration
```

## Progress

Implemented so far:
- Procedural PBR materials (worn plank table, aged board with brass corners, tiles, plaster, fabric, metal, skin).
- Turned Staunton-style pieces plus sculpted knight/bishop/rook/queen/king heads.
- Six environment presets (Institutional Oak, Basement Table, Examination Room, Abandoned Office, Prison Cell, Old Hotel).
- Anatomical procedural forearms + hands (17-bone skeleton, nails, veins, knuckle creases), two-bone IK, finger poses.
- Masked opponent (original riveted cage mask, hood, institutional clothing) with breathing and IK arms.
- Filmic post pipeline: AgX tone mapping, GTAO, bloom, depth of field, grade, vignette, grain.
- Asset pipeline: procedural generation in Web Workers, cached in IndexedDB.

Not yet done: playable game loop UI, clocks HUD, AI opponent, lobby, customization screens, audio, multiplayer server.
