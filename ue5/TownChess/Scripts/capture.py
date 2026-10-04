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
    cap.set_actor_location_and_rotation(pcm.get_camera_location(), pcm.get_camera_rotation(), False, True)
    cc = cap.capture_component2d
    cc.set_editor_property("fov_angle", pcm.get_fov_angle())
    cc.set_editor_property("texture_target", rt)
    cc.set_editor_property("capture_every_frame", True)
    state["cap"] = (world, rt)
    loc = pcm.get_camera_location()
    log(f"capture {w}x{h} fov={pcm.get_fov_angle():.1f} cam=({loc.x:.0f},{loc.y:.0f},{loc.z:.0f}) preset={PRESET}")


def export():
    world, rt = state["cap"]
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
        elif state["phase"] == "warm" and time.time() - state["t0"] >= WARM_SEC:
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
