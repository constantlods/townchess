# TownChess Characters

Status: design draft, 2026-10-03. Nothing here is built yet. This document defines what a character is in data
terms and gives the full bible for the first opponent, who is planned for the Milestone 4 vertical slice.

- Data format: [`content/characters/schema.md`](../content/characters/schema.md)
- First character file: [`content/characters/annotator.json`](../content/characters/annotator.json)

## Part 1. The character system

### 1.1 What a character is

A character is **one JSON definition file plus the assets it names**. The file holds no engine code and no logic. It
is read by three consumers:

| Consumer | Reads | Does |
| --- | --- | --- |
| **Core** (Node, authoritative) | `chess`, `commentary` | Configures the AI seat (strength, style, timing, resign and draw policy). Selects commentary lines from the deterministic `GameEvent` stream, so the browser and UE5 hear the same line for the same game |
| **UE5 client** | `presentation`, `animation`, `behaviour`, `voice`, `intensity` | Spawns the body, clothing and mask; drives clips and procedural layers; plays the chosen line's audio, subtitle and animation hint |
| **Browser client** | `presentation.browserFallback`, `commentary` | Uses the procedural opponent with the character's colours and subtitles. It has no voice audio until the files exist |

The recommended split is that **commentary selection runs in the core**. It is a pure function of events, the seed
and the settings, so it can be unit-tested and replayed. Clients only present the result. See open question Q6.

### 1.2 Sections of a definition file

| Section | Contents | Why it is separate |
| --- | --- | --- |
| `id`, `displayName`, `version`, `status` | Stable identifier used in saves, PGN tags and audio keys | Renaming a character must not break saves |
| `presentation.body` | MetaHuman body preset, skeleton, LOD policy, whether the face and groom are loaded | The body is licensed for UE only and is never shipped to the browser |
| `presentation.materialSlots` | Named slots (`skin_hand`, `cloth_outer`, `mask_metal` and so on) mapped to material instances and their parameters | Lets one body serve several characters, and lets the intensity setting swap parameters |
| `presentation.clothing` | Skinned clothing meshes, the slot each uses, and whether simulation is allowed (default: no) | Clothing is original work and kept separate from the licensed body |
| `presentation.mask` | One hero static mesh attached to a head socket, its offset, and its material parameters | The hero mask is the main identity asset and the most expensive single prop |
| `presentation.props` | Held or table props (ledger, pencil and so on) and their sockets | Behaviour animations reference props by key |
| `animation` | Clip keys mapped to assets, and which behaviours are procedural layers and with what parameters | Keeps the clip list small and swappable |
| `behaviour` | Idle loop, the think layer, the move style, and a reaction table keyed to game events | Describes how the character acts, independent of what it says |
| `voice` | Casting notes, the processing chain preset, the audio key prefix, and the subtitle style | Shared by every line |
| `chess` | AI seat parameters: engine skill, style biases, opening repertoire, time usage, resign and draw policy | A "personality" is behaviour on top of an engine; no Elo is claimed |
| `commentary` | Global limits plus an array of lines keyed to events | Plain data, so writers can add lines without code changes |
| `intensity` | LOW, MEDIUM and HIGH overrides for behaviour, lighting cues and the allowed commentary tier | Accessibility. LOW must be fully playable and still in character |

### 1.3 Runtime rules shared by every character

1. **Presentation never runs ahead of the authority.** A reaction to a move starts only after the core has accepted
   the move (Milestone 3 rule). Reactions to the character's own move begin when its hand has released the piece.
2. **One spoken line per ply at most**, and silence is a valid outcome. A character that talks on every move stops
   being frightening.
3. **Determinism.** Line selection uses a seeded random generator: `seed = hash(gameId, ply, lineId)`. The same game
   always produces the same lines, which allows replays, tests and spectator sync.
4. **The engine decides moves, and the character decides only timing and theatre.** Style parameters bias choices
   among near-equal candidates. They never pick a move outside the engine's tolerance.
5. **Behavioural delays belong to the AI seat**, which runs on the server, so they are charged to the character's
   clock honestly. Clients never add hidden delays beyond animation time. Competitive animation mode removes all
   theatrical holds.
6. **Accessibility overrides everything.** Reduced motion, reduced horror effects and competitive mode clamp
   intensity, shorten holds and disable lamp flicker, whatever the character file says.

## Part 2. Character #1: The Annotator

### 2.1 Name and concept

- **Name:** The Annotator. **Data id:** `annotator`. **On-screen plate:** `THE ANNOTATOR`.
- **Archetype mix:**
  - institutional horror: a records clerk who outlived the building he served;
  - the silent executioner: he barely speaks and never hurries;
  - psychological horror: he writes down everything you do.
- **Concept.** He was the man who kept the records in a closed institution. Nobody told him to stop. He still sits
  at the same table under the same lamp, and anyone who sits down opposite him is "entered". He plays correct,
  patient, punishing chess. After every move, yours and his, he writes it in a cloth-bound ledger with a pencil.
  He wears a two-leaf riveted steel face plate that he made himself. On the right leaf, the only eye opening is a
  small drilled grid patterned like a chessboard.
- **What the player should feel:** watched and recorded, not chased. The threat is that **nothing you do goes
  unrecorded**. His tells are precision and stillness, never rage.
- **What he never does:** shout, laugh, carry a weapon, threaten bodily harm in words, touch the player's pieces
  except to capture them, or reach toward the camera (one HIGH-intensity exception, see 2.6).
- **Why this name.** "Annotation" is the chess word for marking moves (`!`, `?`, `??`). It also ties to the
  engine-backed events planned for Milestone 5: when you blunder, he writes `??` beside your move. A web search on
  2026-10-03 found no horror character with this name. A proper trademark search is still open (Q1). "The
  Invigilator" was considered and dropped, because an exam supervisor called the Invigilator is central to the film
  *Exam* (2009).

### 2.2 Silhouette and costume

**Silhouette rule.** It has to read at 1.3 m in low warm light, from the waist up:

- an **upright, narrow, square-shouldered** torso, unlike the prototype's hunch;
- a **flat-topped oval metal face** that catches the lamp;
- **two pale forearm shapes** (the oversleeves) framing the board.

Dark mass, one bright face shape and two pale bars should be recognisable as a thumbnail.

| Layer | Description | Build notes |
| --- | --- | --- |
| **Head covering** | A close-fitting coif of coarse undyed linen, darkened with age. It covers the skull, ears and neck down to the collar. A visible hand-stitched seam runs over the crown, front to back. The mask's head band sits over it | It replaces all hair, so there is no groom. One skinned mesh on the head and neck joints with a 2K texture set. Crown seam and stitching go in the normal map |
| **Work coat** | A collarless, long-sleeved clerk's coat in faded slate green wool twill (about #3E4A43 at full light, nearly black in shadow). It has a **high off-centre placket** that buttons on his left side, with six flat horn buttons and the top one always fastened. One breast pocket holds the spare pencil stubs. Ink and graphite stains sit on the right cuff and the pocket edge. The fabric is stiff and pressed, never draped | One skinned mesh with no cloth simulation. Corrective morphs on shoulder and elbow only. Folds are sculpted. The asymmetric placket is a key silhouette break: it keeps him away from any doctor's coat or suit |
| **Oversleeves** | Clerk's sleeve protectors in tan cotton duck, from wrist to just below the elbow, elastic-gathered at both ends, with graphite smudges along the outer forearm where it drags over the ledger | Two skinned meshes. Their pale value is deliberate, because it makes the arms readable in low light |
| **Shirt** | Only a 2 cm band of off-white collarless shirt shows at the throat, under the coif hem | A strip on the coat mesh, not a separate garment |
| **Gloves** | Grey-beige thin cotton handling gloves, slightly loose at the fingertips. The **right index finger is cut off at the last joint**, and the cut is hemmed with black thread. Graphite darkens the left thumb, index and middle fingertips | See 2.4 |
| **Props** | A cloth-bound ledger (27 × 20 × 3 cm, dark oxblood cloth, worn corners, ribbon marker); a hexagonal pencil about 11 cm long with a metal-ferrule eraser; a small row of captured pieces lying on their sides at his right | Ledger and pencil are hero props, 2K each. The captured-piece row reuses the game's piece meshes |
| **Chair** | A plain bentwood chair. Only the back is visible behind his shoulders | Environment asset, not character |

Palette: slate green, tan, linen grey, oxblood, with steel and copper on the mask. No red stains on him; blood is not
part of his look.

### 2.3 Hero mask specification

A rigid face plate built from two hand-formed steel leaves riveted together along a vertical spine. The model is
in centimetres and its origin is the wearer's nasion (the bridge of the nose). "Viewer-left" and "viewer-right"
mean as seen by the player.

**Overall form**

| Measure | Value |
| --- | --- |
| Outline | Flat-topped oval. A straight brow edge, sides curving to a rounded chin. No points or horns, and not triangular |
| Height (brow edge to chin) | 24.0 cm |
| Width at the brow edge | 15.0 cm |
| Width at the cheekbone line (9 cm below the brow) | 17.5 cm, which is the widest point |
| Width 4 cm above the chin | 11.0 cm |
| Depth (spine ridge to the plane of the outer rim) | 7.5 cm |
| Horizontal curvature | Radius about 11 cm, wrapping the face |
| Vertical curvature | Radius about 30 cm, so it reads flatter top to bottom than a face |
| Stand-off from the skin | 1.0–1.5 cm, so it never intersects the MetaHuman head under any blendshape |
| Sheet thickness | 0.15 cm real; model 0.2 cm so the edge reads |

**Construction details**

1. **Two leaves.** The plate is two separate leaves meeting down the centre line. The viewer-left leaf overlaps the
   viewer-right leaf by 1.8 cm, and the overlap edge is visible as a step.
2. **Spine strap.** A flat steel strap 1.4 cm wide, 0.4 cm thick and 23 cm long covers the overlap from brow edge to
   chin. It has **9 domed copper rivets**, each 0.6 cm in diameter and 0.25 cm high, at a 2.6 cm pitch.
3. **Rolled edge.** The whole outer outline has a rolled (wired) bead 0.5 cm in diameter. This is the main polished
   highlight.
4. **Eye grid (viewer-left leaf, over the wearer's right eye).** Its centre is 3.2 cm left of the spine centre line
   and 10.0 cm below the brow edge. A scribed 8 × 8 grid sits at a 0.45 cm pitch, 3.6 × 3.6 cm overall, with lines
   0.03 cm deep. Holes 0.25 cm in diameter are drilled through **only the 32 "dark squares"**, so the eye opening
   is a checker pattern. Behind it, an emissive-free dark pupil plane sits at 1.2 cm depth. **This is the only
   opening in the mask.**
5. **Blind side (viewer-right leaf, over the wearer's left eye).** It has no opening. There is a hammered dent 2.5 cm
   across and 0.4 cm deep, offset 0.8 cm up and outward from the eye centre, with radial planishing marks around it.
6. **Repair patch.** On the viewer-right leaf, at the lower cheek, sits a rectangular steel patch 4 × 6 cm and 0.15 cm
   thick, at about 8° to the vertical. It has six copper rivets 0.4 cm in diameter, two on each long side and one at
   each end, and one of them is missing (an empty drilled hole with rust streaks below).
7. **Temple tabs.** Two steel tabs, 2.5 × 4 cm, are riveted (two rivets each) to the leaf edges at temple height. Each
   is hinged to the head band by a simple knuckle hinge 0.8 cm in diameter.
8. **Head band.** A steel band 2.2 cm wide and 0.3 cm thick sits at brow height around the head over the coif, about
   58 cm in circumference. It closes at the back with a leather strap and a plain roller buckle. A 2 cm leather crown
   strap runs front to back. The back is rarely seen and only needs mid detail.
9. **Mouth and nose.** There are **no openings**: no grille, slots or teeth. The lower edge is cut straight across
   under the chin, and a 1 cm band of the coif is visible below it.
10. **Tally field.** Fine scratched tally marks in groups of five sit on the viewer-right leaf, in an area 6 × 2 cm
    just under the brow edge. Their count is a material parameter (0–40, from a tally atlas mask), so the game can
    increase it as the player loses to him.
11. **Thumb-worn spot.** On the viewer-left cheek edge there is an area about 3 × 2 cm, polished almost to a mirror,
    where he pushes the mask straight with his left thumb. Graphite fingerprints surround it.

**Material layering** (one material and one UV set; authored procedurally from masks so it stays tunable)

| # | Layer | Mask source | Values |
| --- | --- | --- | --- |
| 1 | Cold-rolled steel base | Everything | Metallic 1, base colour about #6E6A64, roughness 0.38–0.45, CC0 brushed or rolled detail normal tiled 8× |
| 2 | Planishing facets | Sculpted normal | Shallow hammer facets on both leaves, denser around the dent |
| 3 | Heat tint | Painted around rivets and the dent | Faint straw-to-blue tint, saturation under 15% |
| 4 | Oxidation | Cavity AO, curvature (concave), gravity-down streaks below rivets and the empty hole | Base colour #5A3524 to #8A5A33, **metallic 0**, roughness 0.75–0.9, pitting normal from a CC0 rust scan |
| 5 | Copper rivets | Rivet ID mask | Copper base #B87350, metallic 1, roughness 0.3 on the domes; verdigris #5E8B76, metallic 0, roughness 0.85 in the crevice rings |
| 6 | Polished wear | Convex curvature on the rolled edge, spine strap, rivet domes and the thumb spot | Rust removed, roughness 0.15–0.22. **Roughness floor 0.12** to limit TSR shimmer |
| 7 | Graphite smudge | Painted fingerprints near the thumb spot and on the spine | Dark grey, metallic 0, roughness 0.55 |
| 8 | Dust | Up-facing occlusion (the top of the brow edge and the upper rims of the grid holes) | Light grey-brown, roughness 0.9, low opacity |
| 9 | Tally scratches | Atlas mask times a scalar parameter | Bright steel with roughness 0.25 inside the scratch, so they glint only under the lamp |

**Targets:** 40–70k triangles for LOD0 including rivets and the grid holes (the holes can be an opacity-free
parallax or real geometry; prefer real geometry for the 32 holes). Textures: one 4K set of base colour (BC7),
normal (BC5) and ORM (BC7), plus a 1K tiling detail normal and a 1K tally atlas. The mesh is a rigid static mesh
attached to the `head` socket, not skinned. It can be Nanite if the attach path is validated in 5.8.

**Approval gate:** sculpt the mask blockout, light it under the slice's lamp at 1.3 m and get owner sign-off (Q2)
before texturing.

### 2.4 Hands

His hands are on screen more than his face, so they carry most of the character.

**Build**

- MetaHuman hands at normal adult proportions (about 19.5 cm wrist crease to middle fingertip). They are **not
  elongated**, to keep them clear of the long-limbed horror look.
- **Glove meshes** fit over the MetaHuman hand skeleton. The hand skin under the gloves is hidden: the material masks
  it away or the polygons are deleted, so it costs nothing.
- **The exposed fingertip.** Only the last phalanx of the right index finger is bare skin: pale, the nail cut short
  and very clean, with a faint graphite grey on the pad. This tiny area is the only skin on the character.
  - Shade it with the cheap `Subsurface` model, or `Default Lit` with a warm tint.
  - It is a few hundred pixels on screen, so a full Subsurface Profile is not worth its cost.

**Readable behaviours.** Each is visible at 1.3 m in low light:

| # | Behaviour | Spec |
| --- | --- | --- |
| H1 | **Ledger posture (rest)** | Both palms flat on the table on either side of the ledger, fingers together, thumbs parallel to the index fingers, wrists level. Symmetric and completely still apart from breathing |
| H2 | **The trace (thinking)** | The right index lifts about 1 cm and traces a small slow path on the wood, 2–6 cm long, as if drawing a line of moves. Procedural (IK target on a spline). `tellAccuracy` decides whether the path points toward the real move's source square: 0 means a decoy, 1 means honest. It is off in competitive mode |
| H3 | **Crown pinch (move)** | The thumb and the bare index pinch the piece by its head, straight down from above. The middle finger braces king and queen. **The piece lifts straight up 4 cm, crosses at a constant height in a straight line, and comes straight down.** There is no arc, overshoot or follow-through. During the descent, knights are rotated so they face the player |
| H4 | **The seal** | After release, the bare index taps the top of the piece once (soft click, about 120 ms), then the hand goes back to ledger posture |
| H5 | **Capture** | The captured piece is lifted first with the same pinch and laid **on its side** in a row to his right: bases toward him, in capture order, 3.5 cm apart. Then the capturing move is made. The row stays for the whole game |
| H6 | **Notation** | After every completed ply, his left hand (he is left-handed) writes in the ledger for 1.0–1.8 s. It is skipped when his clock is under 30 s, and **its absence is the readable sign of time pressure** |
| H7 | **Mask set** | The left thumb pushes the mask's left cheek edge (the polished spot) up by about 2 mm. An idle fidget, at most once every 3 minutes, never during the player's move |
| H8 | **Pencil down** | He lays the pencil parallel to the ledger's edge, aligning it with one fingertip. Used for the player's blunders (2.5) |

**Hard rules:**

- He never grips a piece around its body.
- He never drops or flicks a piece.
- He never touches a player piece except to capture it.
- His hands never cross the board's midline except during a move.

### 2.5 Movement language and behaviours by game event

**Movement language**

- Mostly stillness.
- Movements start slowly, travel at a constant speed and stop dead, like a critically damped spring. There is no
  anticipation and no follow-through.
- The head moves less than the hands. The mask follows the board, not the player.
- He looks **at the player's hands** at key beats, and **at the player's face (the camera)** only within a per-game
  budget (`directGazeBudget`, default 3 at MEDIUM).
- He sits so that the mask is at the **edge of the lamp's light**. Leaning into the light is reserved for beats that
  matter, which makes it an event in itself.

**Reactions.** Clip names refer to 2.7. "Gaze" means the procedural look-at.

| Game event (core) | Mover | Behaviour |
| --- | --- | --- |
| Player's turn begins | — | Ledger posture. Gaze rests on the board centre and drifts slowly to whichever piece the player hovers or selects (the client sends the hover; the delay is 0.4 s so it doesn't feel like tracking) |
| Player's move accepted | player | Gaze snaps to the destination square. Notation (H6) |
| His turn, thinking | — | `think` loop plus the trace (H2). Breathing slows. The longer he thinks, the further forward he leans, up to 4 cm |
| `capture` | him | Capture sequence (H5), then seal |
| `capture` | player | He watches the piece leave the board. The player's captures go to the **player's** side and he never touches them. Notation is a beat slower |
| `check` | him | After the seal, the bare index **stays on the piece for 1.5 s** ("holding the check"), then he withdraws |
| `check`, `double_check`, `discovered_check` | player | `react_check`: a single small head tilt toward his king, then stillness. No flinch |
| `castle_*` | either | Castling uses two pinches, king first. No extra reaction |
| `promotion` | him | He takes the replacement piece from his row of captured pieces, if there is one of the right type, otherwise from off-board, and stands it up |
| `opening_identified`, `gambit_offered` | either | When the line plays, the notation lasts longer and he underlines it (an additive on the notation clip) |
| `material_swing` (against him) | player | Gaze to the player's hands for 2 s |
| Player blunder (engine, Milestone 5; before that, `material_swing` ≥ 5 against the player) | player | `react_player_blunder`: pencil down (H8), a slow lean into the lamp light, gaze at the player's hands, a hold of 3–8 s (`blunderHoldSeconds`, charged to his own clock), then he writes `??` |
| Own blunder (engine) or a `material_swing` ≥ 5 against him | him | `react_own_blunder`: he turns the pencil and erases his last line for too long (3 s), then writes it again exactly the same |
| `checkmate` | him (he wins) | `mate_win`: seal, holds the king's square with the index for 2 s, closes the ledger, presses it flat with his palm, and **leans fully into the light for the first time**. Gaze goes to the player's face. At HIGH, he slides the ledger 10 cm toward the player |
| `checkmate` | player (he loses) | `mate_loss`: he lifts his own king with the pinch and stands it in front of the player's side of the board, upright. Then he leans back until the mask leaves the light. The ledger stays open |
| `resign` | him | `resign_self`: lays his king on its side with both hands, as if laying something down to rest, then closes the ledger |
| `resign` | player | Writes one line, closes the ledger, places both hands on top of it |
| Draw offer (sent by him) | — | `offer_draw`: turns the ledger round to face the player and taps a blank line twice. The UI offer appears when the tap lands |
| `draw_*`, `stalemate` | — | Writes a short line, closes the ledger half-way, ledger posture |
| `timeout` | either | If he flags: he stops mid-movement and holds that pose for 2 s, which is the only time he looks interrupted. If the player flags: pencil down, gaze at the player's face (uses the budget) |
| Game start | — | `intro`: see 2.7 |

### 2.6 Chess personality

He plays **correct, patient, positional chess that punishes loose pieces**. He prefers solid structures and trades
into endgames where he is better, rarely gambles, and takes free material without hesitation. At the table, he plays
at an **even tempo** and saves his long silences for the player's mistakes.

These are AI-seat parameters, not ratings. **No Elo is claimed.** The strength levels map onto the current alpha-beta
engine (`maxDepth`, `timeMs`, `noise` in `packages/client/src/game/ai.ts`). After Milestone 5 they map onto
Stockfish's skill controls. All labels stay uncalibrated until measured.

| Parameter | Default | Range | Meaning |
| --- | --- | --- | --- |
| `engine.levels` | `"measured"` | `steady`, `measured`, `exacting` | Named strength presets. The character's default is `measured` |
| `steady` | depth 3, 1000 ms, noise 40 cp | — | Loose. For new players |
| `measured` | depth 4, 1800 ms, noise 20 cp | — | Default |
| `exacting` | depth 5, 2500 ms, noise 0 cp | — | Equal to today's Warden settings |
| `style.candidateWindowCp` | 30 | 0–80 | Style biases may only choose among moves within this many centipawns of the best |
| `style.tradeBias` | +0.6 | −1…+1 | Prefers equal trades when ahead or level |
| `style.quietMoveBias` | +0.4 | −1…+1 | Prefers quiet improving moves over speculative checks |
| `style.pawnStructureBias` | +0.5 | −1…+1 | Avoids doubled or isolated pawns among equal candidates |
| `style.kingSafetyBias` | +0.5 | −1…+1 | Castles early. Prefers kingside |
| `style.greedForFreeMaterial` | 1.0 | 0–1 | Always takes undefended material when it is within the window |
| `openings.asWhite` | Queen's Gambit Declined (via 1.d4 2.c4), London System as the fallback | Lichess family names | Weighted book choice |
| `openings.asBlackVsE4` | Caro-Kann Defense 0.7, French Defense 0.3 | — | — |
| `openings.asBlackVsD4` | Queen's Gambit Declined 0.6, Slav Defense 0.4 | — | — |
| `openings.vsOther` | Respond on engine | — | — |
| `openings.bookDepthPlies` | 10 | 0–20 | Leaves book after this many plies |
| `openings.acceptGambitProbability` | 0.35 | 0–1 | He mostly declines. Accepting is rarer and gets a line |
| `time.model` | `even` | `even`, `front`, `back` | Spends a similar time on every move rather than front-loading |
| `time.fractionOfRemaining` | 1/30 | — | Base allotment per move. Real engine time is capped by the level's `timeMs`; the rest is theatrical hold |
| `time.minThinkSeconds` | 2.5 | 0–10 | Never moves instantly, even in book. Theatrical; skipped in competitive mode |
| `time.maxThinkSeconds` | 25 | — | — |
| `time.blunderHoldSeconds` | 3–8 | 0–12 | Silence after a player blunder. Charged to his own clock |
| `time.lowTimeThresholdSeconds` | 30 | — | Below this he drops notation and theatrical holds |
| `resign.policy` | `material` before Milestone 5, `eval` after | — | — |
| `resign.materialDeficit` / `resign.evalCp` | 9 / −900 | — | Must hold for `resign.forPlies` |
| `resign.forPlies` | 8 | — | — |
| `draw.offers` | true | — | Offers only from move 40 when material is equal and there are no pawns, or the eval is within ±0.3 |
| `draw.acceptsWhen` | Material balance ≤ 0 for him and move ≥ 30 | — | Declines every earlier offer without comment |
| `tells.tellAccuracy` | 0.5 | 0–1 | Whether the trace (H2) points at his real move |
| `tells.directGazeBudget` | 3 | 0–6 | Per game, scaled by intensity |

### 2.7 Animation: minimum clip set

The body is retargeted from the MetaHuman skeleton. Everything below the table edge is hidden, so clips are
upper-body only, on a seated base pose. Procedural layers use Control Rig, plus the Milestone 3 hand-rig IK.

| Clip key | Kind | Length | Notes |
| --- | --- | --- | --- |
| `idle_breath` | **Procedural** | loop | An additive breathing curve on spine_03, clavicles and head (0.8° pitch), rate 9–14 per minute, scaled by tension (slower when he is winning). Plus subtle weight shifts |
| `think` | **Hybrid** | 4–6 s loop | One authored seated-forward posture loop. The trace (H2), the lean and the breathing are procedural on top |
| `look_at` | **Procedural** | — | Head and neck aim with spring damping, clamped ±35° yaw and ±20° pitch. Targets: board square, the player's hands, the player's face, the ledger |
| `finger_trace` / tap | **Procedural** | — | IK on the right index along a spline. The seal tap is procedural too |
| `reach_grip_place` | **Procedural + 3 poses** | per move | Milestone 3 IK reach, lift, carry, place and release, with three authored hand poses: `pose_pinch`, `pose_pinch_braced`, `pose_flat`. Straight-line carry and no overshoot, as in H3 |
| `capture_set_aside` | **Procedural** | per capture | The same IK, with the target in the captured-piece row |
| `notate` | Authored, 2 variants | 1.0–1.8 s | Left-hand writing. An additive underline variant for opening lines |
| `mask_set` | Authored, additive | 1.2 s | H7 |
| `react_check` | Authored, additive | 1.0 s | Head tilt and stillness. Also used for double and discovered checks |
| `react_player_blunder` | Authored | 3.0 s plus a procedural hold | Pencil down, lean into the light. The hold is procedural |
| `react_own_blunder` | Authored | 4.0 s | The erase |
| `mate_win` | Authored | 6–8 s | Close the ledger and lean in. The HIGH variant adds the ledger slide |
| `mate_loss` | Authored + IK | 6 s | The king placement is IK. The lean back is authored |
| `resign_self` | Authored + IK | 5 s | Both hands lay the king down, then the ledger closes |
| `offer_draw` | Authored | 3 s | Ledger turn and double tap |
| `intro_sit` (+ `intro_lamp_on`) | Authored | 8–10 s (5 s) | He enters from the dark at the back, pulls out the chair, sits, sets the ledger and pencil down, aligns them, and takes the ledger posture. **`intro_lamp_on`, used at LOW and as the fallback if mocap of the walk is unavailable:** he is already seated in the dark, the lamp comes on, and he opens the ledger |

That is **13 authored clips** (`think`, `notate` × 2, `mask_set`, the six reactions and endings, `offer_draw`,
`intro_sit`, `intro_lamp_on`) plus 3 static hand poses and 5 procedural layers. The source should be one short mocap session (seated, about 30 minutes of takes) or hand-keyed; it is an
owner decision (Q4).

### 2.8 Voice direction

- **How much he talks:** very little. The file has about 70 lines, and by design most plies are silent. He averages
  under one line every five moves.
- **Casting:** a male voice, playing age 50–70, light baritone. Quiet, precise, clerical. Clear consonants, no
  regional caricature, and **no gravel, growl or theatrical menace**. He sounds like someone reading a record aloud
  who is mildly disappointed by its contents. Do not cast a sound-alike of any known horror performer.
- **Delivery:**
  - Close-mic and low level, never projected.
  - Pauses before the last word rather than after it.
  - Questions are delivered flat, not as questions.
  - Ellipses in the script mean a 0.6–1.2 s held breath, not a trailing voice.
- **Processing chain:**
  1. High-pass at 90 Hz.
  2. A **plate resonance** convolution IR. Make our own: record a voice or a sweep 2 cm behind a sheet of 1.5 mm
     steel, or behind the physical mask if one is built. Wet 25–35%.
  3. A gentle 2.5 kHz dip and a narrow 5 kHz metallic lift.
  4. A very short room send matched to the environment.
  - **No pitch shifting, ring modulation, distortion or bitcrush.** Those are the clichés that push toward existing
    characters.
  - Spatialise from the mask socket with near-field attenuation.
- **Non-verbal set:**
  - breath through the plate (3 variants);
  - pencil writing, erase and set-down;
  - the seal click;
  - the ledger closing (2 variants);
  - the mask-set scrape.
  These carry more of the character than the lines do.
- **Subtitles are always available.** The subtitle text may differ from the spoken text (see schema), for example
  `[writes]`.

### 2.9 Horror-intensity scaling

The player chooses LOW, MEDIUM or HIGH; the default is MEDIUM. The existing "reduced horror effects" setting forces
LOW. Reduced motion and competitive mode apply on top.

| Aspect | LOW | MEDIUM | HIGH |
| --- | --- | --- | --- |
| Commentary tiers allowed | `low` only | `low`, `medium` | All |
| Direct gaze budget per game | 0 (hands and board only) | 3 | 6 |
| Lean into the lamp light | Only on checkmate | Blunder beats and checkmate | Plus long thinks |
| Blunder hold | 1.5 s maximum | 3–6 s | 5–8 s |
| Lamp | Steady | One brief dip on a player blunder | Dips on blunders and checks. Never above 3 Hz, never full black, and never strobing |
| Mask tally marks | Hidden (count 0) | Shown | Shown, and incremented on screen after a loss |
| Captured-piece row | Upright | On their sides | On their sides, ordered by value |
| Intro | Lamp-on fallback | `intro_sit` | `intro_sit` with footsteps starting off-screen behind the player's left |
| Checkmate win | Ledger closes | Plus lean in and gaze | Plus ledger slide toward the player |
| Breathing audio | Off | Soft | Audible through the plate |

**Never at any tier:**

- a jump scare;
- a sudden loud sound (all one-shots are limited to −12 dBFS peak relative to the ambience);
- gore, or blood on him;
- any reach toward the camera faster than 30 cm/s.

### 2.10 Production asset list and GPU/VRAM risk

The target is about 2–4 ms of GPU for the character at 1440p HIGH with TSR at 67% on the RX 6650 XT, measured
against the benchmark baseline (14.5 ms GPU). The estimates below are guesses until measured in Milestone 4.

| Asset | Source | Size / budget | GPU risk | VRAM (approx.) | Notes |
| --- | --- | --- | --- | --- | --- |
| MetaHuman body, upper half visible | MetaHuman (UE-only licence) | LOD0 about 30–40k visible triangles | Low, about 0.3 ms | 60–120 MB | Use body LOD1 at this distance if it holds up. Lower legs can be culled with a hidden-material mask |
| **MetaHuman face** | — | **Not loaded** | Avoided, saving roughly 1–2 ms | Saves 200+ MB | The full mask and coif hide it. Use a simple head mesh or the lowest face LOD with no face rig evaluation |
| Groom (hair, brows, lashes) | — | **None** | Avoided | — | The coif removes the need. Groom is the single most expensive item to avoid |
| Coif | Original | 2K set | Low | about 20 MB | — |
| Work coat | Original, sculpted folds | 4K set, about 25k triangles | Low to medium, 0.2–0.4 ms | about 60 MB | **No cloth simulation.** Corrective morphs only. Wool sheen via `Cloth` shading is optional; prefer Default Lit with a fuzz term faked in the roughness |
| Oversleeves ×2 | Original | Shared 2K set | Low | about 15 MB | — |
| Gloves ×2 | Original | Shared 2K set | Low | about 15 MB | — |
| Bare fingertip | MetaHuman hand skin, cropped | A few hundred pixels | Low if `Subsurface` (cheap); avoid a full Subsurface Profile | Shared | — |
| **Hero mask** | Original sculpt; CC0 detail scans | 40–70k triangles; 4K set plus 1K detail plus 1K tally | **Medium**: 0.2–0.5 ms plus reflections | about 70–90 MB | Main risk is **specular shimmer** on the rolled edge and rivets under TSR at 67%. Use a roughness floor of 0.12, geometric specular AA, and check with motion. Lumen reflections are needed; judge hardware ray tracing for this asset again, as PERFORMANCE.md suggests |
| Ledger, pencil | Original | 2K and 1K | Low | about 25 MB | Ledger pages: one static open mesh plus a closed mesh, swapped; **no page simulation** |
| Captured-piece row | Reuses piece meshes | — | Negligible | — | — |
| **Key-light shadows on a skinned mesh** | — | — | **Medium to high** | — | A moving skinned character invalidates virtual shadow map pages under the lamp every frame. Mitigations: keep the lamp's shadow on VSM but limit the character's shadow LOD; use contact shadows for the fingers; measure `stat VirtualShadowMaps`. A fallback is a local spot shadow map for the character |
| Control Rig and IK | — | — | CPU only | — | The game thread is at 2.5–2.8 ms; fine |
| Voice and SFX | Original recordings | about 70 lines plus about 15 non-verbal | — | about 30 MB of audio (RAM, not VRAM) | — |

**Estimated total:** about 1.0–2.0 ms of GPU and about 400 MB of VRAM, within the 2–4 ms budget and comfortably
inside the 8 GB card at 3.1 GB baseline. The two items most likely to break the estimate are the virtual shadow map
invalidation and the mask's reflections.

### 2.11 Originality check

The aim is to evoke archetypes without copying any existing character. These are the nearest existing characters
and the concrete differences.

| Nearest existing character | Possible confusion | How the Annotator differs |
| --- | --- | --- |
| **Hannibal Lecter's restraint mask** (*The Silence of the Lambs*) | A metal face covering on a captive-looking man | Lecter's mask is a **mouth grille and muzzle** worn with restraints. The Annotator's plate covers the whole face and has **no mouth opening at all**, the only opening is a checker-drilled eye grid, and he is unrestrained and in charge of the room |
| **Pyramid Head** (*Silent Hill 2*) and DbD's Executioner | The silent executioner archetype, metal headgear | Pyramid Head has a huge triangular helmet, a bare torso, a butcher's apron and a giant blade, and is defined by his walk and drag. The Annotator has a close-fitting **flat-topped oval** plate, is fully clothed in a clerk's coat, has **no weapon**, and is seated |
| **Silent Hill nurses** | Institutional horror | No bandaged face, no nurse uniform, no jerky movement. His movement language is the opposite: smooth, constant speed, no twitching |
| **Outlast**: Chris Walker, Dr. Trager; **Outlast Trials**: Leland Coyle, Mother Gooseberry; Murkoff | Asylum and institutional horror, medical menace, finger trauma | No asylum patient or doctor costume, no surgical tools. The cut glove fingertip is **a clerk's practical cut, not mutilation**, and no finger harm is shown or mentioned. No riot gear, goggles or night-vision. No Murkoff-style corporate naming (the prototype reference's "MurkoffGuest" is already removed) |
| **Jigsaw and Billy** (*Saw*) | A "game master" who sets tests, a processed voice | No puppet, no spiral cheeks, no tapes or TVs, no tricycle. His voice is **not** pitch-shifted or distorted. He sets no moral tests and says nothing about deserving to live: **the chess is just chess**. Writing rule: never "let's play a game" or "make your choice" phrasing |
| **The Trapper, The Doctor, Legion and others** (*Dead by Daylight*) | Masked killer roster | No teeth on the mask, no electro-shock headgear or mouth spreader, no hunting weapon, no chase role |
| **Resident Evil**: Garrador, Dr. Salvador, Mr. X, the RE5 Executioner Majini | Masked brutes, a tall silent pursuer | No blindfold or claws, no sack mask, no chainsaw or axe, no hat or trench coat. He doesn't pursue, and he does nothing at speed |
| **Slender Man** | Tall, still, faceless | He has a visible, physical, hand-made metal mask, not a blank face. He wears a work coat (no suit or tie), has normal limb proportions and no tendrils, and he doesn't appear and disappear |
| **The Phantom of the Opera** | A masked man in a dark room, a mask with one asymmetry | The Phantom wears a white half mask on one side, a cape and evening dress, and is romantic and theatrical. The Annotator's mask is full-face, steel, with an asymmetric eye grid, and he is terse and clerical |
| **The Big Daddy** (*BioShock*) | Riveted metal headgear | The Big Daddy wears a full diving helmet with round portholes and a drill. The Annotator has a face plate only, with no portholes and no diving hardware |
| **The Keeper** (*The Evil Within*), the **Janitor** (*Little Nightmares*) | Institutional or object heads; hands-focused horror | No object for a head. Hands are normal-length, gloved and precise, not blind groping |
| **Death playing chess** (*The Seventh Seal*) | The chess-against-death archetype | No black hood or robe and no pale face. He is a records clerk, not a personification |
| **The Man in the Iron Mask** (historical legend), **Ned Kelly's armour** (a real person) | Iron face covering | No helmet or slit visor, so no Ned Kelly silhouette. Two riveted leaves and a checker eye grid, not a smooth iron mask |
| **The Invigilator** (*Exam*, 2009) | Exam supervision theme | The name was rejected for this reason. The theme is record-keeping, not exam rules, and there is no suited corporate figure |
| **The prototype's cage mask** | Our own earlier design | The cage was an open lattice over the whole head. The new mask is a closed plate with a single small perforated grid |

**Signature elements that are ours:**

- the two-leaf steel plate with a copper-riveted spine;
- the checker-drilled single eye grid;
- the thumb-polished cheek spot;
- the tally field as a game-state parameter;
- clerk's oversleeves and the off-centre placket;
- the cut right index finger used for the crown pinch;
- the seal tap and the held check;
- the sideways row of captured pieces;
- per-ply notation, whose absence shows time pressure;
- the `??` written after your blunder.

**Process guard:** the mask concept art and blockout must be reviewed side by side with the table above before
texturing. No reference boards may include screenshots of the listed characters as direct reference.

### 2.12 Open questions for the owner

| # | Question |
| --- | --- |
| Q1 | Approve the name "The Annotator"? A trademark and title search is still to be done |
| Q2 | Approve the mask concept (two-leaf plate, checker eye grid, copper rivets) before the sculpt starts? |
| Q3 | Voice casting: hire an actor (with a recording and an AI-use clause) or use a placeholder? Should the voice be English only for the slice? |
| Q4 | Animation source: a short seated mocap session, hand-keyed animation, or licensed generic clips? This affects `intro_sit` |
| Q5 | Should the tally marks persist across sessions (this needs persistence, which is not in the roadmap until Milestone 6)? |
| Q6 | Should commentary selection live in the core (recommended) or in each client? |
| Q7 | Should `tellAccuracy` be visible to the player as a difficulty option, or stay hidden? |
| Q8 | Who authors the mask: an in-house sculpt in Blender, or a contractor? Substance tools require a licence; the layer stack above can also be built in Blender or ArmorPaint |
