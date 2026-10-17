# Phase A: hands and character audit (hands/character specialist, 2026-10-13)

Independent inspection of the shared baseline (`docs/graphics/baseline/base_main.jpg`, `base_hands.jpg`,
`base_opponent.jpg`, `base_black.jpg`, commit 7cb3a50) against `docs/reference/concept-reference.jpg` (main panel,
HAND CUSTOMIZATION panel, PIECE INTERACTION panel). The other specialists' Phase A outputs were not read. No scene
change was made.

## Extra evidence taken (one capture cycle, Windows lock owner `hands-character`, acquired and released)

Same editor build as the baseline (C:\TownChess\townchess at 7cb3a50), `capture.ps1 -Preset epic -Auto cpu:novice:w:untimed -WarmSec 22`:

| Shot (C:\TownChess\shots\) | Camera | What it shows |
|---|---|---|
| `hc_side.png` (`-Probe Player`) | `-tcview=0 -TCCamLoc=-24,-75,98 -TCCamTarget=-24,-18,94 -TCFov=34`: side view along the near rank at board height | The left hand hangs in the air **well above** the near frame and the rank-1 pieces; fingertips droop toward the board but touch nothing |
| `hc_top.png` (`-Probe Board`) | `-TCCamLoc=-28,-4,160 -TCCamTarget=-28,-4,88 -TCFov=55`: from above | Left hand left of the a1 corner, over the record sheets; right hand in front of the h1 corner, off the frame; fingers straight and splayed |
| `hc_low.png` | `-TCCamLoc=-46,-52,86 -TCCamTarget=-24,-16,90 -TCFov=40`: low, behind the a1 rook | Rank-1 pieces in the foreground, the fingertips ~10 cm above the king's cross |

Probe (world space, cm; table/board top z = 80.0, board at (0,0), squares 5.8 cm, rank 1 at x = -20.3):

```
player body actor   loc (-87.0, -3.0, 19.4) yaw -90       camera (view 0) (-87, 0, 122) pitch -19
player head bone    (-96.5, 0.8, 132.5)                    <- build_scene.py's ploc formula aims it at z = top+34 = 114.0
lowerarm_l (elbow)  (-66.5, -20.0, 100.9)   hand_l (wrist) (-40.6, -19.9, 99.5)  X=(0.98,-0.19,0.11) Z=(-0.21,-0.65,0.73)
lowerarm_r (elbow)  (-74.5,  17.3, 101.1)   hand_r (wrist) (-48.9,  20.5, 99.7)  X=(-0.97,-0.24,-0.09) Z=(0.24,-0.97,-0.03)
opponent head       (67.1, -3.8, 105.8)
```

Solver vs runtime: the solver's targets reproduce in x/y within 2.6 cm (wrist target x -38 / y -19, measured -40.6 /
-19.9) and the wrist sits exactly 32 cm under the runtime head as `ARM_TARGETS["player"]["hand"]` asks (132.5 - 32 =
100.5, measured 99.5). But the whole body is **18.5 cm higher** than `build_seated_pose` believes (head 132.5 vs the
114.0 that `ploc` was computed for). The arm targets are relative to the head and carry the comment "head sits ~34 cm
over the table"; at runtime the head is 52.5 cm over it, so both wrists float 19.5 cm over the table and the elbows 21 cm.

## 1. Geometry and proportion

- Body: MetaHuman `MH_Walter` body (BuiltCine if present), own proportions from the reference skeleton. The arm/hand
  meshes have real human proportions; the top view (`hc_top`) shows normal finger length and hand width.
- The "stubby flat fingers" in `base_hands.jpg` are mostly pose and camera: (a) the fingers are blended 80% toward the
  MetaHuman reference pose (`TC_FINGER_RELAX=0.8`), which is straight and splayed, so they read as flat paddles;
  (b) the close-up is 33 cm from the wrist at 36 deg, which foreshortens the fingers behind a large forearm;
  (c) no knuckle articulation reads because no joint is bent.
- Hand orientation: the left hand's Z axis is 43 deg off vertical and the right's lies horizontal (different bone
  conventions per side through `TC_HAND_ROLL=-95`); from above both show their backs, so the roll is acceptable, but
  the wrists are not extended (no "hand lying on a surface" break at the wrist).

## 2. Pose and contact (the hand on the pieces, the knight through the palm)

- Measured: **nothing touches anything.** Both hands hover 17-20 cm over the table and 10+ cm over the tallest
  rank-1 piece (`hc_side`, `hc_low`). In `base_hands.jpg` the hovering hand sits at piece-head height in the camera's
  line of sight, so its silhouette overlaps the a/b-file pieces and reads as resting on them with the knight passing
  into the palm. From the seat (`base_main.jpg`) the high camera hides the gap and the hands read as lying on the
  corners.
- The trap for the obvious fix: dropping the body by 18.5 cm without changing the target puts the wrist at (-40.6,
  -19.9, ~81) with the fingers 18-19 cm long along X=(0.98,-0.19), i.e. fingertips at about (-23, -23): onto the a1
  rook's base and across the b1 knight. The left hand is aimed straight down the a-file. The hover is what hides that
  collision today.
- Framing conflict (geometry, view 0.6 = default: camera +16.8 cm up, +3 cm forward, pitch -25 deg, 26.4 mm, vertical FOV 42 deg): bottom frame edge
  ~-46 deg. A wrist on the table at x = -42 is 53 deg below the eye: out of frame; knuckles (x ~ -32) at ~48 deg: just
  out; fingertips on the near frame (x ~ -24) at ~43 deg: in frame. A correct resting pose therefore shows fingers and
  part of the back of the hand at the bottom corners, as in the reference only if the camera or lean changes
  (visual director's camera block). Passes 60-63 raised the hands (lean 12 -> 16, target +8 cm, elbows may lift) to keep
  wrists in frame; that is what produced the hover.
- Reference: hands lie on the near board frame at both corners, fingers gently curled with the pads on the frame,
  thumbs under/along the edge, wrists on the table, forearms leaving the bottom corners with cuffs/watch visible.

## 3. Skin presentation

- `base_hands.jpg`: saturated orange-tan, the `dirty` grime as separate dark blotches ("leopard spots"), veins as
  long dark smears, no visible nails, no knuckle creases, low specular variation (dry plastic sheen). The reference is
  grey-brown, desaturated, grime packed into creases, nail folds and knuckles with a thin oily sheen, and blood/scratch
  accents.
- From the seat (`base_main.jpg`) the backs of the hands read better: veins and grime show at the right density.
- Causes (in `ue5/tools/textures/skin.py`, owned by materials): blotch noise in `grime_amt` "blotches" (line ~412) is
  isotropic and high-contrast, not driven by the crease mask; `spots` (age spots, line 247) adds more discrete dots;
  nails exist in the texture (pass 63) but are never seen because the fingertips are straight and pointed away.
- My share: nails and creases only read once fingers curl (section 2/fix 2). Request to materials: dirt from the
  crease/curvature mask and nail folds first, blotches at half contrast and lower frequency; base colour -15%
  saturation on the hand only; roughness variation (oilier knuckles).

## 4. Sleeve and watch

- Sleeve (`props.py sleeve()`, `SM_PlayerSleeve`): a rigid straight tube 20 cm long, r 5.0 -> 4.4 cm, 32 sides
  (64 after one subsurf level), 2% sinusoidal "folds", attached along elbow->wrist of the solved pose. In
  `base_hands.jpg` it shows facet steps on the silhouette and banded flat shading (the 0.5 cm facets are ~30 px at
  that distance; the stepped shading suggests the OBJ import did not keep the smooth normals), a perfectly
  cylindrical form with no compression folds, no cuff, no contact with the table. Tint 0.11/0.12/0.13 reads olive grey
  under the warm grade; the reference's "Institutional Sleeves" are pale, stained canvas with a rolled, frayed cuff.
- Watch (`props.py wristwatch()`, pass 60): sits on the left wrist, the printed dial reads; the strap is a flat slab
  with box keepers and a hard edge where it meets the case; the case floats slightly proud of the skin in the close-up.
  Acceptable at the seat (`base_main.jpg` bottom left), weak in a close-up. Lower priority than the sleeve.

## 5. Opponent (caged patient): pose, clothing, idle

- Pose (`POSES["clasp"]`, `ARM_TARGETS["clasp"]` hand (3, 18, -21) from the head, elbow_z -31): in `base_main.jpg` the
  forearms form a flat horizontal bar at chest/table height, one hand laid over the other forearm (crossed arms), the
  torso upright. The reference's opponent leans in with elbows on the table, forearms near vertical, fingers
  interlaced in front of the mouth, head bowed so the eyes look up from shadow. Our target is 21 cm under the head
  bone (chest), not at the mouth, and the spine leans back (spine_01 -4, spine_03 -7). His fingers keep the idle's curl
  (the relax/blend is player-only), so there is no interlacing.
- Clothing: long drab shirt (`MI_PatientShirt` 0.42/0.40/0.34) plus the pass-61 canvas sleeves (`MI_PatientJacket`)
  and the straitjacket straps. From the seat the shirt reads smooth olive-green with a pale bib (the strap block) and
  no folds (`base_main.jpg`, `base_black.jpg`); in `base_opponent.jpg` the shirt is clean off-white with a hard
  collar edge. The reference: heavy, wrinkled, filthy grey-brown canvas with stains and blood.
- Idle: the pose is a single keyed frame (`set_number_of_frames(1)`), looping: the character is a statue. Nothing
  breathes or moves between moves.
- Face/cage (`base_opponent.jpg`): the MetaHuman face and the iron cage are the strongest assets in the scene; the bald
  scalp catches the lamp hot (head top over the cage in `base_main.jpg`).

## 6. The five largest failures, ranked

| # | Failure | Cause in code | Fix | Acceptance test | Effort |
|---|---|---|---|---|---|
| 1 | **Player hands hover 17-20 cm over the table; no contact anywhere** (the "knight in the palm" is a hovering hand overlapping pieces on screen; lowered as-is it would truly hit a1/b1) | `build_scene.py` player block: `ploc` assumes the solver's head height but the runtime head is 18.5 cm higher (probe); `ARM_TARGETS["player"]["hand"]=(19,58,-32)` is relative to the head with a stale "34 cm over the table" premise; `TC_TABLE_Z` is read but not used for the hands; the IK error has no term for the board, frame or pieces | (a) Close the loop: after authoring the sequence, evaluate it on the target mesh (`AnimPoseExtensions.get_anim_pose_at_time` on the new `A_TC_Seated_*`, which applies the skeleton's translation retargeting) and correct `ploc`/the solver by the measured head offset; assert solver vs evaluated < 1 cm. Likely cause to confirm there: the pelvis translation track (47 cm drop) is only partly honoured at runtime. (b) Express targets in table space: palm on the table/frame (wrist z = top + 4..6), fingertip line on the near frame (x in [-27.5, -23.5]) at the a1/h1 corners with the hand yawed ~25 deg inward, so fingers lie along the frame, not down the files. (c) Add IK penalties: any finger joint inside a rank-1/2 piece cylinder (r 2.4 cm, h 9 cm around each occupied square) or under the frame top. (d) Raise with the visual director: pitch/focal/lean so knuckles and part of the back of the hand stay in frame (section 2) | `-TCProbe=Player`: hand_l/hand_r z in [83, 87]; fingertip proxy (wrist + 18 cm along X) x <= -23.5. `hc_side`/`hc_low` cameras: fingertips on the frame with no visible gap (< 0.5 cm) and no piece intersecting the hand. `hc_top`: both hands on the frame corners. Main view at view 0 and 0.6: fingers and knuckles of both hands visible. Autotests cpu and drag unchanged | 1 day + 3-4 capture cycles; camera change needs the visual director |
| 2 | **Fingers straight, splayed, lifeless** ("stubby flat fingers"); no grip on the frame edge; nails never visible | `build_seated_pose`: player fingers blended 80% to the MetaHuman reference pose (straight A-pose fingers) and keep 20% of a hanging idle's curl; no per-finger or per-joint shaping; thumb spread | Author a resting-hand finger pose instead of the blend: per joint curl about each finger's hinge axis (measure the local axes once with the probe): MCP 15-25, PIP 25-35, DIP 10-15 deg, rising index -> pinky; spread reduced ~30%; thumb adducted ~20 deg and lying along the frame's edge; keep `TC_FINGER_RELAX` as the fallback | Top view: finger gaps <= 1 cm, fingers converge; side close-up: pads on the frame top, knuckles raised; seat view: nails readable on at least 3 fingers per hand (V4 note); judge hands score >= 7 (V4) | 0.5 day + 2 cycles (with fix 1) |
| 3 | **Opponent pose is not the reference's and never moves**: forearms flat at chest height, crossed, upright torso; a single-frame statue | `POSES["clasp"]` (spine leans back, head 4) and `ARM_TARGETS["clasp"]` hand 21 cm under the head; the finger relax is player-only so his fingers keep the idle curl; `build_seated_pose` keys 1 frame | Clasp: spine_01/03 +6/+10 (lean in), head +12 (bowed), hand target at the mouth (about (2, 16, -8)), elbows on the table (`elbow_z` from the table, not the head), `elbow_x` ~16 for a steeple; author interlaced fingers (alternating spread, deep PIP curl). Idle without any C++ or chess contact: key a 4 s, 120-frame loop in `build_seated_pose` (spine_03 breathing +-0.8 deg at 0.25 Hz, head drift +-1.5 deg over 8 s, occasional finger press); it plays through the existing single-node looping anim | Main view: his clasped hands overlap the lower third of the cage; probe: lowerarm_l/r z within 3 cm of the table top + forearm radius. Idle: two captures 2 s apart differ in the torso/head region (mean abs diff > 2/255) and are pixel-identical on the board region; autotests unchanged | 0.5 day pose + 0.5 day idle + 2 cycles |
| 4 | **Sleeve is a rigid faceted tube**: banding, stepped silhouette, no folds or cuff, olive grey, ends in the air | `props.py sleeve()`: 32-sided cylinder, 2% folds, 2 mm solidify, 1 subsurf, smart-project UVs, OBJ export (normals apparently not kept on import); `MI_PlayerSleeve` tint 0.11/0.12/0.13; placed on the hovering arm | New wearable generator for the player sleeve: 64 sides before subdivision, compression folds toward the elbow and a sag on the underside (displacement, not 2% ripple), a rolled cuff torus with a frayed edge; weighted normals; check the import keeps normals (or bake a normal map for the folds). Hand the colour to materials (pale stained canvas like the reference's "Institutional Sleeves"). After fix 1 the cuff rests on the table | `base_hands` camera: no facet step on the silhouette, no banding; folds visible; cuff edge reads as cloth. Seat view: sleeve not olive (g/b of the sleeve region < 1.1) | 0.5 day + 1 cycle (+ materials) |
| 5 | **Skin reads orange with leopard-spot dirt** in close-ups | `ue5/tools/textures/skin.py` (materials): isotropic high-contrast grime blotches and age spots not tied to creases; saturation; uniform roughness. Plus pose (nails hidden) | Materials: crease/nail-fold driven dirt, blotches at half contrast and lower frequency, hand-only desaturation, oily knuckle roughness. Mine: fix 2 exposes nails and creases | Close-up at the `base_hands` camera: no isolated dark spot > 6 mm with sharp edges (judge); hand region mean r/g within 0.05 of the reference hands panel's; judge V4 >= 7 | Materials 0.5 day; mine is fix 2 |

Secondary (not in the top five): watch strap slab and keepers (close-up only); the patient's shirt reads olive/clean
and smooth (materials tint + a folded shirt mesh; request to materials/board-environment for cloth detail); hot
bald scalp under the lamp (lighting).

## 7. Design: hand-driven piece moves that cannot affect chess state (for the lead; no implementation here)

Today pieces fly alone: `ATCBoard::AnimateMove` queues `FAnim` entries (lerp + sine lift, `MoveSeconds` 0.2 s) only
after `OnCoreState` receives exactly one new authoritative move; `FinishAnims` lands everything when the player acts;
`IsInSync` / `Resyncs` rebuild from the authority if the shown board ever differs.

Principle: **the piece leads, the hand follows.** The board keeps sole ownership of piece transforms and of when they
move; the hand is a read-only follower that can be deleted without any other change.

1. Component: `UTCHandPresenter` (C++, lead) on the player body actor (`TC_PlayerBody`) and optionally on the
   opponent. It drives the arm with a two-bone IK (upperarm/lowerarm/hand) plus a blended finger pose, either through
   a `UPoseableMeshComponent` copy of the arm or a native `UAnimInstance` that layers IK over the seated pose. No anim
   graph authoring is needed for the first version.
2. Inputs (read-only): `ATCBoard` exposes a const view of the running `FAnim` group (target component, From, To, T,
   Duration, Lift) and of the drag state (`DragFrom`, the carried piece's world location from `UpdateDrag`). The
   presenter never calls a board or core method that changes anything.
3. Player moves (drag and drop): on `BeginDrag` succeeding, the hand blends (0.12 s) from the rest pose to a pinch
   grip whose fingertip midpoint IK-tracks the carried piece's top each frame; on drop the hand opens and returns
   (0.3 s). Illegal drop: the board's `SnapBack` moves the piece; the hand follows it back. The move is sent on drop
   exactly as now; acceptance timing is untouched.
4. Engine/online moves: on a new `FAnim` group the presenter can (option A, no board change) follow the piece during
   the existing 0.2 s flight with the hand pre-shaped, which reads as a flick; or (option B, small board change) the
   lead adds a purely visual `PresentSeconds` that stretches the flight to ~0.9 s (reach 0.3, grip 0.08, carry 0.35,
   release/return 0.2). In option B the authoritative state, clocks and the core are already updated before the hand
   moves; only the drawn piece is late, and `FinishAnims` (called by `BeginDrag` and any new state) snaps both the
   piece and the hand instantly. The opponent's hand (across the table) is the natural actor for engine moves; the
   player's hand for the player's own moves.
5. Safety rules:
   - The presenter has no write access to `ATCBoard`, `UTCCoreClient`, the protocol, the clock or input routing; it
     subscribes to events and reads transforms.
   - Hand IK never pushes a piece: contact is cosmetic (the fingers target the piece, not the reverse). A kill switch
     (`-tchands=0` and a setting) removes the presenter; the game must behave identically.
   - Any new state while a hand animation runs (resign, draw, takeback, resync, new game, rebuild) cancels it and
     returns the hand to rest in one frame.
   - Grip poses (pinch for pawn/bishop/queen/king, wide for knight/rook) are authored by the hands specialist in
     `build_seated_pose` as extra single-frame sequences, so the C++ only blends between them.
6. Acceptance: autotests cpu N/N and drag 8/8 identical with the presenter on and off (same PGN for the same seeds, same
   move-sent timestamps within one frame, `Resyncs` stays 0); a 10-frame capture strip of a pawn pinch with no
   finger-piece interpenetration (probe: fingertip-to-piece distance 0-0.5 cm at grip); frame time cost < 0.3 ms.
7. Effort: lead C++ 2-3 days (presenter, IK, board read-only hooks, tests); hands specialist 1 day (grip poses, rest
   pose compatible with IK, captures).

## Requests to the lead / other owners

- Lead: review fix 1's approach (evaluated-pose loop); the hand-move design above; `capture.py` probe could also log
  the finger tips (`index_03_l` etc.) so contact is measured, not judged.
- Visual director: the framing conflict in section 2 (resting hands vs the default view 0.6).
- Materials: skin dirt/saturation (failure 5), sleeve and patient shirt colours.
