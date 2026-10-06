"""Reference-comparison screenshot from the player's seat (uncooked -game; start with the py console command).

    UnrealEditor TownChess.uproject /Game/TownChess/L_Table -game -RenderOffscreen -tcauto=cpu:novice:w:untimed \
        -ExecCmds="py Scripts/capture.py" -TCShot=C:/TownChess/shots/now.png -TCShotRes=1920x1080 -TCWarmSec=25

Waits for shaders/Lumen to settle, points the level's ShotCapture at the player camera (HighResShot writes nothing
under -RenderOffscreen), exports a PNG and quits. -TCPreset picks the scalability level (default cinematic for
reference shots; use high/medium to judge the runtime target).
"""
import time

import unreal

PRESETS = {"low": 0, "medium": 1, "high": 2, "epic": 3, "cinematic": 4}


def arg(name, default):
    for tok in unreal.SystemLibrary.get_command_line().split():
        if tok.lower().startswith(f"-{name.lower()}="):
            return tok.split("=", 1)[1].strip('"')
    return default


SHOT = arg("TCShot", "C:/TownChess/shots/shot.png")
RES = arg("TCShotRes", "1920x1080")
WARM_SEC = float(arg("TCWarmSec", 25))
PRESET = PRESETS.get(arg("TCPreset", "cinematic").lower(), 4)
# -TCSource=basecolor|normal|final: debug the material inputs directly (G-buffer captures)
SOURCES = {"final": "SCS_FINAL_TONE_CURVE_HDR", "basecolor": "SCS_BASE_COLOR", "normal": "SCS_NORMAL"}
SOURCE = arg("TCSource", "final").lower()
PLAY = int(arg("TCPlay", "0"))          # play this many plies (our side: first legal move) before the shot
CLIPBOARD = arg("TCClipboard", "") == "1"  # raise the game-record clipboard for the shot
CAM_LOC = arg("TCCamLoc", "")   # close-up shots: x,y,z (cm) ...
CAM_ROT = arg("TCCamRot", "")   # ... pitch,yaw,roll
CAM_FOV = arg("TCFov", "")
CAM_TARGET = arg("TCCamTarget", "")  # aim the close-up at this point (x,y,z) instead of giving a rotation
HUD = arg("TCHud", "") == "1"  # draw the game HUD over the shot (what the player sees, not just the scene)
CMDS = [c.replace("_", " ") for c in arg("TCCmds", "").split(";") if c]  # console commands, "_" for spaces (e.g. r.Fog_0)
state = {"f": 0, "t0": time.time(), "phase": "warm", "tcap": 0.0}


def log(msg):
    unreal.log(f"[TCSHOT] {msg}")


def cmd(c):
    unreal.SystemLibrary.execute_console_command(None, c)


def camera_manager():
    for pcm in unreal.ObjectIterator(unreal.PlayerCameraManager):
        try:
            if pcm.get_world() is not None:
                return pcm
        except Exception:
            pass
    return None


def begin():
    pcm = camera_manager()
    world = pcm.get_world()
    caps = [c for c in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.SceneCapture2D)]
    if not caps:
        raise RuntimeError("no SceneCapture2D (ShotCapture) in the level")
    w, h = (int(x) for x in RES.split("x"))
    rt = unreal.RenderingLibrary.create_render_target2d(world, w, h, unreal.TextureRenderTargetFormat.RTF_RGBA8_SRGB)
    cap = caps[0]
    loc, rot, fov = pcm.get_camera_location(), pcm.get_camera_rotation(), pcm.get_fov_angle()
    if CAM_LOC:
        loc = unreal.Vector(*[float(v) for v in CAM_LOC.split(",")])
    if CAM_ROT:
        p_, y_, r_ = [float(v) for v in CAM_ROT.split(",")]
        rot = unreal.Rotator(r_, p_, y_)
    if CAM_TARGET:
        t = unreal.Vector(*[float(v) for v in CAM_TARGET.split(",")])
        rot = unreal.MathLibrary.find_look_at_rotation(loc, t)
    if CAM_FOV:
        fov = float(CAM_FOV)
    cap.set_actor_location_and_rotation(loc, rot, False, True)
    cc = cap.capture_component2d
    cc.set_editor_property("fov_angle", fov)
    cc.set_editor_property("texture_target", rt)
    cc.set_editor_property("capture_every_frame", True)
    cc.set_editor_property("capture_source", getattr(unreal.SceneCaptureSource, SOURCES.get(SOURCE, SOURCES["final"])))
    state["cap"] = (world, rt)
    probe(world)
    log(f"capture {w}x{h} fov={fov:.1f} cam=({loc.x:.0f},{loc.y:.0f},{loc.z:.0f}) preset={PRESET}")  # the shot camera, not the player's


def probe(world):
    """-TCProbe=<substring>: log world transforms of matching actors (and the opponent's head bone) for placement checks."""
    key = arg("TCProbe", "").lower()
    if not key:
        return
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        if key in a.get_actor_label().lower() or key in a.get_name().lower():
            l, r = a.get_actor_location(), a.get_actor_rotation()
            parent = a.get_attach_parent_actor()
            log(f"probe {a.get_name()} loc=({l.x:.1f},{l.y:.1f},{l.z:.1f}) rot=({r.pitch:.0f},{r.yaw:.0f},{r.roll:.0f}) "
                f"parent={parent.get_name() if parent else None} hidden={a.is_hidden_ed() if hasattr(a, 'is_hidden_ed') else '?'}")
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.SkeletalMeshActor):
        smc = a.skeletal_mesh_component
        if smc.does_socket_exist("head"):
            h = smc.get_socket_location("head")
            log(f"probe head of {a.get_name()} at ({h.x:.1f},{h.y:.1f},{h.z:.1f})")


def export():
    world, rt = state["cap"]
    if HUD:
        pc = unreal.GameplayStatics.get_player_controller(world, 0)
        hud = pc.get_hud() if pc else None
        if hud and hasattr(hud, "draw_to_render_target"):
            hud.draw_to_render_target(rt)
        else:
            log("no TCHUD to draw")
    d, name = SHOT.replace("\\", "/").rsplit("/", 1)
    unreal.RenderingLibrary.export_render_target(world, rt, d, name)
    log(f"exported {SHOT}")


def tick(_dt):
    try:
        state["f"] += 1
        if state["f"] == 2:
            for g in ("ViewDistanceQuality", "AntiAliasingQuality", "ShadowQuality", "GlobalIlluminationQuality",
                      "ReflectionQuality", "PostProcessQuality", "TextureQuality", "EffectsQuality", "ShadingQuality"):
                cmd(f"sg.{g} {PRESET}")
            cmd(f"r.SetRes {RES}w")
            for c in CMDS:
                cmd(c)
            if PRESET >= 3:  # RTX reference quality: hardware ray-traced Lumen and RT shadows (the RX 6650 XT target stays software)
                for c in ("r.Lumen.HardwareRayTracing 1", "r.Lumen.Reflections.HardwareRayTracing 1", "r.RayTracing.Shadows 1"):
                    cmd(c)
        elif state["phase"] == "warm" and PLAY and not state.get("played"):
            core = next((o for o in unreal.ObjectIterator(unreal.TCCoreClient) if not o.get_name().startswith("Default__")), None)
            if core and core.has_game():
                st = core.get_state()
                if len(st.history) >= PLAY or st.status != "active":
                    state["played"] = True
                    state["t0"] = time.time() - WARM_SEC + 6  # let the last animation and the sheet settle
                elif core.is_my_turn() and time.time() - state.get("moved_at", 0) > 1.2 and st.legal_moves:
                    mv = st.legal_moves[len(st.history) % len(st.legal_moves)]
                    core.submit_move(mv[:2], mv[2:4], mv[4:] if len(mv) > 4 else "")
                    state["moved_at"] = time.time()
        elif state["phase"] == "warm" and time.time() - state["t0"] >= WARM_SEC:
            if CLIPBOARD and not state.get("raised"):
                pcm = camera_manager()
                clips = unreal.GameplayStatics.get_all_actors_of_class(pcm.get_world(), unreal.TCClipboard)
                if clips:
                    clips[0].set_raised(True)
                    log(f"clipboard raised: {len(clips[0].get_sheet_lines())} lines, opening '{clips[0].get_opening_line()}'")
                state["raised"] = True
                state["t0"] = time.time() - WARM_SEC + 2.5  # raise animation + focus pull
                return
            begin()
            state["phase"], state["tcap"] = "capturing", time.time()
        elif state["phase"] == "capturing" and time.time() - state["tcap"] >= 4:  # TSR/Lumen history in the capture
            export()
            state["phase"] = "done"
            cmd("quit")
    except Exception as e:
        log(f"FAILED {e}")
        state["phase"] = "done"
        cmd("quit")


unreal.register_slate_post_tick_callback(tick)
log(f"armed shot={SHOT} res={RES} warm={WARM_SEC}s")
