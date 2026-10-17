# Character definition format (schema version 1)

A character is one UTF-8 JSON file in `content/characters/<id>.json`. This page defines every field. The design
reasons are in [`docs/CHARACTERS.md`](../../docs/CHARACTERS.md). The event names match `GameEventType` in
`packages/shared/src/events.ts`.

General rules:

- Unknown top-level keys are an error. Unknown keys inside `presentation`, `animation` and `behaviour` are allowed and
  ignored, because clients evolve at different speeds.
- Every id-like string matches `^[a-z0-9][a-z0-9_.-]*$`.
- Times are in seconds unless the field name ends in `Ms`. Material values are in pawns (P=1, N=3, B=3, R=5, Q=9).
- Asset references are **keys**, not file paths. Each client resolves them: UE5 through a data table mapping keys to
  soft object paths, and the browser through its own fallback.
- "Opponent" means **the character**. "Player" means the human or agent in the other seat.

## 1. Top level

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schemaVersion` | integer | yes | Must be `1` |
| `id` | string | yes | Stable id. Must equal the file name without `.json`. Used in saves, PGN `[Black "..."]` tags and audio keys |
| `displayName` | string | yes | Shown on the player plate |
| `version` | string (semver) | yes | Content version of this file |
| `status` | `"draft"` \| `"approved"` \| `"shipped"` | yes | — |
| `concept` | string | yes | One-paragraph pitch, for tools and humans |
| `tags` | string[] | no | Free tags |
| `presentation` | object | yes | §2 |
| `animation` | object | yes | §3 |
| `behaviour` | object | yes | §4 |
| `voice` | object | yes | §5 |
| `chess` | object | yes | §6 |
| `intensity` | object | yes | §7 |
| `commentary` | object | yes | §8 and §9 |

## 2. `presentation`

| Field | Type | Meaning |
| --- | --- | --- |
| `body.source` | `"metahuman"` \| `"custom"` | Base body |
| `body.preset` | string | Asset key of the body preset |
| `body.skeleton` | string | Skeleton key. Clips must target it |
| `body.loadFace` | boolean | `false` = do not load the face rig or face mesh. Required when a full mask hides the face |
| `body.loadGroom` | boolean | `false` = no hair or fur grooms |
| `body.lodBias` | integer | Added to the automatic LOD (0 = none) |
| `body.hiddenRegions` | string[] | Body regions masked out because clothing covers them (`"hands_except_r_index_distal"`, `"legs_below_knee"`, and so on) |
| `materialSlots` | object of slot name → `{ material: key, params?: object }` | Material instances per named slot. Parameter values are numbers, `[r,g,b]` arrays or texture keys |
| `clothing[]` | `{ id, mesh, slot, simulate: boolean, notes? }` | Skinned clothing pieces. `simulate` should be `false` unless measured |
| `mask` | `{ mesh, socket, offset: {loc:[x,y,z], rot:[p,y,r]}, slot, params? }` or `null` | Hero mask, a rigid mesh attached to a socket. Offsets in cm and degrees |
| `props[]` | `{ id, mesh, socket \| "table", notes? }` | Held or table props referenced by behaviours |
| `browserFallback` | `{ primary: "#rrggbb", secondary: "#rrggbb", maskStyle: string }` | Hints for the procedural browser opponent |

## 3. `animation`

| Field | Type | Meaning |
| --- | --- | --- |
| `clips` | object of clip key → `{ asset, kind, lengthS?, loop?, additive?, variants?: string[] }` | `kind` is `"authored"`, `"procedural"`, `"hybrid"` or `"pose"`. `asset` is `null` for purely procedural clips |
| `procedural` | object of layer name → parameters | Parameters for the procedural layers: `breathing`, `lookAt`, `fingerTrace`, `ik` and others. A client that does not know a layer ignores it |

The required clip keys for a playable character are: `idle_breath`, `think`, `look_at`, `reach_grip_place`,
`react_check`, `react_player_blunder`, `react_own_blunder`, `mate_win`, `mate_loss`, `resign_self`, `offer_draw`,
`intro_sit`. Characters may add more (`notate`, `mask_set`, and so on). **Animation hints** in commentary lines (§9)
must be clip keys from this table, or `null`.

## 4. `behaviour`

| Field | Type | Meaning |
| --- | --- | --- |
| `idle` | object | Rest posture key, fidget list `[{ clip, minIntervalS, maxIntervalS }]` |
| `moveStyle` | object | How the character handles pieces: `grip` (`"pinch_top"` and so on), `liftCm`, `carry` (`"straight"` \| `"arc"`), `rotateKnightsToFace` (`"player"` \| `"self"` \| `null`), `sealTap`, `capturePlacement` |
| `reactions[]` | `{ event, mover?, conditions?, clip, gaze?, holdS?, intensityMin? }` | Body reactions keyed to the same events and conditions as commentary (§9.2). The client plays the first matching entry. Reactions are independent of whether a line is spoken |
| `gaze` | object | `directGazeBudget` per game, and the default target |

## 5. `voice`

| Field | Type | Meaning |
| --- | --- | --- |
| `audioKeyPrefix` | string | For example `"vo.annotator."`. Each line's `audio` key must start with this prefix |
| `casting` | string | Notes for casting |
| `delivery` | string | Notes for the director |
| `processing` | object | Named effect-chain preset and its parameters (convolution IR key, EQ, wet mix, and so on). **Forbidden here:** pitch shift and distortion (by project rule, see CHARACTERS.md §2.11) |
| `nonVerbal` | object of key → string[] | Non-verbal sound keys (breath, writing, and so on) |
| `subtitleStyle` | `{ speakerLabel, colour }` | — |

## 6. `chess`

| Field | Type | Meaning |
| --- | --- | --- |
| `defaultLevel` | string | Key into `levels` |
| `levels` | object of key → `{ label, builtin: { maxDepth, timeMs, noiseCp }, stockfish?: { skillLevel?, moveTimeMs?, nodes? } }` | Strength presets. `builtin` maps to `SearchOptions` in the existing engine (`noise` is in centipawns). `stockfish` is used from Milestone 5. **No Elo or rating field is allowed**; labels are words |
| `style` | object | `candidateWindowCp` plus biases in −1…+1. Biases only reorder moves within `candidateWindowCp` of the best |
| `openings` | object | `asWhite`, `asBlackVsE4`, `asBlackVsD4`, `asBlackVsOther`: arrays of `{ family, weight, line? }`, where `family` is a Lichess family name and `line` is optional SAN movetext. Plus `bookDepthPlies` and `acceptGambitProbability` |
| `time` | object | `model`, `fractionOfRemaining`, `minThinkS`, `maxThinkS`, `blunderHoldS: [min,max]`, `lowTimeThresholdS`. Theatrical time is charged to the character's own clock by the AI seat |
| `resign` | object | `policy` (`"never"` \| `"material"` \| `"eval"`), `materialDeficit`, `evalCp`, `forPlies` |
| `draw` | object | `offers`, `offerMinMove`, `acceptMinMove`, `acceptIfBalanceAtMost` (pawns, character's point of view) |
| `tells` | object | `tellAccuracy` 0–1, the chance that the thinking gesture points at the real move |

## 7. `intensity`

An object with the keys `low`, `medium` and `high`, and a field `default`. Each tier may override:

- `commentaryTiers`: the allowed line tiers;
- `directGazeBudget`;
- `blunderHoldS`;
- `lampEvents`: whether events may dip the lamp;
- `maskParams`: material parameter overrides, for example `TallyCount` visibility;
- `captureRowStyle`;
- `intro` (clip key);
- `breathingAudio`;
- `notes`.

The player's accessibility settings clamp these values; they can never raise them.

## 8. `commentary` (container)

| Field | Type | Meaning |
| --- | --- | --- |
| `language` | BCP-47 string | Language of `text` and `subtitle` |
| `globalCooldownS` | number | Minimum seconds between any two lines |
| `globalCooldownPlies` | integer | Minimum plies between any two lines |
| `maxLinesPerPly` | integer | Normally `1` |
| `maxLinesPerGame` | integer | Hard cap |
| `eventPrecedence` | string[] | When one ply emits several events, they are considered in this order (for example `checkmate` before `capture`). Events not listed come last in emission order |
| `placeholders` | object | Documents which placeholders the file uses (informational) |
| `lines[]` | Line objects | §9 |

## 9. Commentary line format

### 9.1 Fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Unique within the file. Convention: `<characterId>.<event>.<nnn>` |
| `event` | event type (§9.3) | yes | The event that can trigger the line |
| `conditions` | object (§9.2) | no | All present conditions must hold (AND). An absent condition matches anything |
| `text` | string | yes | The script as spoken; the actor reads this. May contain placeholders (§9.4) |
| `subtitle` | string | no | On-screen text. Defaults to `text`. May differ, for example to add `[writes]` or to drop a stammer |
| `priority` | integer 0–100 | yes | Higher wins when several lines are eligible |
| `probability` | number 0–1 | yes | Chance the line fires when it is chosen as a candidate (seeded, §9.5) |
| `cooldown` | `{ seconds: number, plies: integer }` | yes | Per-line cooldown after the line plays. Both must have elapsed |
| `maxUsesPerGame` | integer ≥ 1 | yes | — |
| `intensity` | `"low"` \| `"medium"` \| `"high"` | yes | The **minimum** horror tier at which the line may play. A `low` line plays at every tier |
| `audio` | string | yes | Audio key; must start with `voice.audioKeyPrefix`. It may be unresolved in a draft file, in which case the line plays as a subtitle only |
| `animation` | clip key or `null` | yes | Hint to the client for an additive or full clip to play with the line. The client may ignore it if a reaction clip is already running |
| `timing` | object | yes | `anchor`: when the delay starts counting (§9.6). `delayMs`: from the anchor. `interruptible`: whether a newer, higher-priority line may cut this one off. `maxLateMs`: drop the line if it cannot start within this window (default 4000) |
| `notes` | string | no | For writers and the actor; never shown |

### 9.2 Conditions

| Key | Type | Matches when |
| --- | --- | --- |
| `mover` | `"player"` \| `"opponent"` | The event's `color` is the player's or the character's seat. For `resign` and `timeout`, the mover is **the side that resigned or flagged**. For `checkmate`, it is the side that delivered mate |
| `piece` | piece letter[] (`p n b r q k`) | The event's `piece` (the moving piece) is in the list |
| `captured` | piece letter[] | The event's `captured` piece is in the list |
| `promotion` | piece letter[] | The event's `promotion` piece is in the list (use it to catch underpromotion) |
| `openingFamily` | string[] | `opening.family` equals one of these (exact, case-insensitive) |
| `ecoPrefix` | string[] | `opening.eco` starts with one of these, for example `"B1"` |
| `materialBalance` | `{ min?, max? }` | Material balance **from the character's point of view** after the event, in pawns. Derived from `balance` (White's point of view) by negating it if the character plays Black. Inclusive bounds |
| `swing` | `{ min?, max? }` | For `material_swing` only: swing **from the character's point of view** (positive = the character gained) |
| `moveNumber` | `{ min?, max? }` | Full move number (`ceil(ply / 2)`). Inclusive |
| `ply` | `{ min?, max? }` | Ply. Inclusive |
| `eventCount` | `{ min?, max? }` | How many times this event type, **with the same `mover` filter if one is given**, has occurred in this game including this one. Example: `{ "min": 3 }` = the third or later check by the player |
| `opponentClockS` / `playerClockS` | `{ min?, max? }` | Remaining clock time after the event, in seconds. Ignored in untimed games |
| `result` | `"opponent_wins"` \| `"player_wins"` \| `"draw"` | For terminal events, the game result from the character's point of view |
| `requiresEngine` | boolean | Informational. Engine-backed events (§9.3) imply `true` |

### 9.3 Event types

**Deterministic core events** are produced by `moveEvents()` and `GameCore` today:

`capture`, `check`, `double_check`, `discovered_check`, `checkmate`, `stalemate`, `castle_kingside`,
`castle_queenside`, `en_passant`, `promotion`, `opening_identified`, `gambit_offered`, `material_swing`,
`draw_repetition`, `draw_fifty`, `draw_insufficient`, `draw_agreed`, `resign`, `timeout`.

Some details of how the core emits these matter for writers:

- `double_check` and `discovered_check` are emitted **together with** `check` (or `checkmate`) on the same ply. A
  matching `double_check` line should outrank the generic `check` line through `eventPrecedence` and `priority`.
- `en_passant` is emitted together with `capture`.
- `opening_identified` fires **each time the deepest named position changes**, so it can fire several times in one
  game (for example family, then variation). Use `ply`, `eventCount` and `maxUsesPerGame` to avoid repetition.
- `gambit_offered` fires once per gambit family, together with `opening_identified`.
- `material_swing` fires when the balance moves by 3 or more over two plies.

**Engine-backed events** are planned for Milestone 5. Lines for them load and validate now, but stay dormant until the
core emits them:

`blunder`, `mistake`, `inaccuracy`, `brilliant`, `missed_win`.

**Session events** come from the session layer, not from `moveEvents()`. They are optional and use the same
format:

- `game_start`;
- `draw_offered` (already a core event type);
- `draw_fivefold`, `draw_seventyfive` and `draw_claimable` (also in the core). A writer may map these onto
  `draw_repetition` or `draw_fifty` lines through `eventAliases` (below).

**`eventAliases`.** An optional container field. It is an object mapping event → event, so that `draw_fivefold` can
reuse `draw_repetition` lines. Example: `{ "draw_fivefold": "draw_repetition", "draw_seventyfive": "draw_fifty" }`.

### 9.4 Placeholders

Placeholders are written as `{name}` and filled from the event. If a line uses a placeholder whose value is absent
from the event, **the line is ineligible**, never spoken with a gap. All placeholders are filled into both `text` and
`subtitle`. For recorded audio, a line with a placeholder needs one recording per value; see "Audio for placeholder
lines" below.

| Placeholder | Source | Example |
| --- | --- | --- |
| `{opening}` | `opening.name` | "Queen's Gambit Declined: Exchange Variation" |
| `{openingFamily}` | `opening.family` | "Queen's Gambit Declined" |
| `{eco}` | `opening.eco` | "D35" |
| `{piece}` | `piece`, as a word | "knight" |
| `{captured}` | `captured`, as a word | "bishop" |
| `{promotion}` | `promotion`, as a word | "queen" |
| `{san}` | `san` | "Nxe5" |
| `{moveNumber}` | `ceil(ply / 2)` | "14" |
| `{count}` | the `eventCount` value | "3" |

**Audio for placeholder lines.** The `audio` key may contain the same placeholders in slugified form, for example
`vo.annotator.opening_identified.001.{openingFamily}`. The client looks up the expanded key and falls back to
`<key-without-placeholder>.generic` (a recording of the line with a neutral substitute, such as "this opening"),
then to subtitles only. The writer decides which opening families are worth recording.

### 9.5 Selection algorithm (deterministic)

For each accepted ply, and for each terminal or session event:

1. Collect the events for the ply. Order them by `eventPrecedence`, then by emission order. Apply `eventAliases`.
2. For each event in order, collect the lines that pass all of these:
   - `event` matches;
   - all `conditions` hold;
   - the line's `intensity` is at or below the effective tier;
   - uses so far are below `maxUsesPerGame`;
   - the per-line cooldown has elapsed;
   - the global cooldown and `maxLinesPerGame` allow another line.
3. Sort the candidates by `priority` (descending), then by `id` (ascending) for stability.
4. Walk the candidates. For each, draw `r = rng(seed = hash(gameId, ply, line.id))`. If `r < probability`, select
   the line and stop.
5. If a line was selected, stop looking at later events for this ply (`maxLinesPerPly` = 1). Otherwise, go on to the
   next event.
6. When a line plays, record the use, its time and its ply, for cooldowns.

The same game with the same settings produces the same lines on every client. Seconds-based cooldowns use the core's
injected clock time, so the result is still deterministic in tests.

### 9.6 Timing anchors

| `anchor` | The delay starts when |
| --- | --- |
| `event` | The core accepts the move or emits the event. Use for terminal events |
| `move_settled` | The moving piece has been released and settled on the board (the client reports this). This is the default for move events |
| `reaction_peak` | The character's reaction clip reaches its marked peak (an anim notify named `LinePeak`). It falls back to `move_settled` plus 800 ms |
| `opponent_turn_start` | The character's thinking begins. Use for lines spoken while thinking |

The client must never speak a line about a move before the core has accepted that move.

### 9.7 Validation

A validator (to be written in Milestone 4) must check:

- the JSON parses and every required field is present;
- ids are unique;
- every `event` is a known type or a declared alias;
- every `animation` is a key in `animation.clips` or `null`;
- every `audio` key starts with the prefix;
- every placeholder is a known name;
- probability is within 0–1 and priority within 0–100;
- no line exceeds 140 characters of `subtitle`, so it fits two subtitle lines;
- there is no `elo` or `rating` field anywhere in `chess`.

## 10. Minimal example

```json
{
  "schemaVersion": 1,
  "id": "example",
  "displayName": "EXAMPLE",
  "version": "0.1.0",
  "status": "draft",
  "concept": "A placeholder used to show the format.",
  "presentation": {
    "body": { "source": "metahuman", "preset": "mh.body.example", "skeleton": "skel.metahuman", "loadFace": false, "loadGroom": false, "lodBias": 0, "hiddenRegions": [] },
    "materialSlots": { "cloth_outer": { "material": "mi.example.coat", "params": { "Tint": [0.25, 0.29, 0.26] } } },
    "clothing": [{ "id": "coat", "mesh": "sk.example.coat", "slot": "cloth_outer", "simulate": false }],
    "mask": null,
    "props": [],
    "browserFallback": { "primary": "#3e4a43", "secondary": "#b9a582", "maskStyle": "plate" }
  },
  "animation": {
    "clips": {
      "idle_breath": { "asset": null, "kind": "procedural", "loop": true },
      "react_check": { "asset": "anim.example.react_check", "kind": "authored", "lengthS": 1.0, "additive": true }
    },
    "procedural": { "breathing": { "ratePerMin": [9, 14] } }
  },
  "behaviour": { "idle": { "rest": "pose_flat", "fidgets": [] }, "moveStyle": { "grip": "pinch_top", "liftCm": 4, "carry": "straight" }, "reactions": [], "gaze": { "directGazeBudget": 2, "default": "board_centre" } },
  "voice": { "audioKeyPrefix": "vo.example.", "casting": "", "delivery": "", "processing": { "preset": "dry" }, "nonVerbal": {}, "subtitleStyle": { "speakerLabel": "EXAMPLE", "colour": "#d8cfc0" } },
  "chess": {
    "defaultLevel": "measured",
    "levels": { "measured": { "label": "Measured", "builtin": { "maxDepth": 4, "timeMs": 1800, "noiseCp": 20 } } },
    "style": { "candidateWindowCp": 30 },
    "openings": { "asWhite": [{ "family": "Queen's Gambit Declined", "weight": 1 }], "bookDepthPlies": 10, "acceptGambitProbability": 0.5 },
    "time": { "model": "even", "fractionOfRemaining": 0.033, "minThinkS": 2, "maxThinkS": 20, "blunderHoldS": [2, 4], "lowTimeThresholdS": 30 },
    "resign": { "policy": "material", "materialDeficit": 9, "evalCp": -900, "forPlies": 8 },
    "draw": { "offers": false, "offerMinMove": 40, "acceptMinMove": 30, "acceptIfBalanceAtMost": 0 },
    "tells": { "tellAccuracy": 0.5 }
  },
  "intensity": { "default": "medium", "low": { "commentaryTiers": ["low"] }, "medium": { "commentaryTiers": ["low", "medium"] }, "high": { "commentaryTiers": ["low", "medium", "high"] } },
  "commentary": {
    "language": "en",
    "globalCooldownS": 8,
    "globalCooldownPlies": 2,
    "maxLinesPerPly": 1,
    "maxLinesPerGame": 30,
    "eventPrecedence": ["checkmate", "double_check", "check", "capture"],
    "lines": [
      {
        "id": "example.check.001",
        "event": "check",
        "conditions": { "mover": "player", "eventCount": { "min": 3 } },
        "text": "Again.",
        "subtitle": "Again.",
        "priority": 40,
        "probability": 0.5,
        "cooldown": { "seconds": 60, "plies": 6 },
        "maxUsesPerGame": 1,
        "intensity": "low",
        "audio": "vo.example.check.001",
        "animation": "react_check",
        "timing": { "anchor": "move_settled", "delayMs": 500, "interruptible": true, "maxLateMs": 4000 }
      }
    ]
  }
}
```
