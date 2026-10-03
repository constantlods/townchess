"""In-game benchmark driver (uncooked -game run; -ExecutePythonScript is editor-only, so start it with the py console command).

    UnrealEditor TownChessBench.uproject /Game/Bench/L_Bench -game -RenderOffscreen -ResX=2560 -ResY=1440 \
        -ExecCmds="py Scripts/bench_game.py" -csvGpuStats -TCWarm=600 -TCFrames=1200 -TCPreset=high

Warms up (shader/PSO compilation, Lumen convergence), applies a scalability preset, records a CSV profile
(FrameTime, GameThread, RenderThread, GPU) over a fixed number of frames, captures the player view through the
level's ShotCapture (HighResShot writes nothing under -RenderOffscreen), then quits.
"""
import time

import unreal

PRESETS = {  # sg.* scalability groups: 0 low, 1 medium, 2 high, 3 epic, 4 cinematic
    "low": 0, "medium": 1, "high": 2, "ultra": 3, "cinematic": 4,
}


def arg(name, default):
    for tok in unreal.SystemLibrary.get_command_line().split():
        if tok.lower().startswith(f"-{name.lower()}="):
            return tok.split("=", 1)[1]
    return default


WARM = int(arg("TCWarm", 600))
FRAMES = int(arg("TCFrames", 1200))
PRESET = arg("TCPreset", "high").lower()
SP = arg("TCScreenPercentage", "")
WARM_SEC = float(arg("TCWarmSec", 20))  # wall-clock floor: first runs compile shaders while frames tick
state = {"f": 0, "t0": time.time(), "start": None}


def cmd(c):
    unreal.log(f"[TCBENCH] exec {c}")
    unreal.SystemLibrary.execute_console_command(None, c)


def _camera_manager():
    for pcm in unreal.ObjectIterator(unreal.PlayerCameraManager):
        try:
            if pcm.get_world() is not None:
                return pcm
        except Exception:
            pass
    return None


def capture_begin():
    """-RenderOffscreen never reads the viewport back, so HighResShot writes nothing. Instead the level carries a
    SceneCapture2D ("ShotCapture", placed by build_scene.py); point it at the player camera and render the final
    tone-mapped colour into a render target for a few frames so TSR/Lumen history settles, then export it."""
    try:
        pcm = _camera_manager()
        world = pcm.get_world()
        caps = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.SceneCapture2D)
        if not caps:
            acts = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor)
            unreal.log(f"[TCBENCH] world={world.get_path_name()} actors={len(acts)} classes="
                       f"{sorted({type(a).__name__ for a in acts})}")
            raise RuntimeError("no SceneCapture2D in level (rebuild with build_scene.py)")
        cap = caps[0]
        w, h = (int(x) for x in arg("TCShotRes", "1920x1080").split("x"))
        rt = unreal.RenderingLibrary.create_render_target2d(world, w, h, unreal.TextureRenderTargetFormat.RTF_RGBA8_SRGB)
        cap.set_actor_location_and_rotation(pcm.get_camera_location(), pcm.get_camera_rotation(), False, True)
        cc = cap.capture_component2d
        cc.set_editor_property("fov_angle", pcm.get_fov_angle())
        cc.set_editor_property("texture_target", rt)
        cc.set_editor_property("capture_every_frame", True)
        state["cap"] = (world, rt, cap)
        unreal.log(f"[TCBENCH] capture started {w}x{h} fov={pcm.get_fov_angle():.1f}")
    except Exception as e:
        unreal.log(f"[TCBENCH] capture_begin failed: {e}")


def capture_export():
    try:
        world, rt, cap = state["cap"]
        shot = arg("TCShot", "/tmp/tc_shot.png")
        d, name = shot.rsplit("/", 1)
        unreal.RenderingLibrary.export_render_target(world, rt, d, name)
        unreal.log(f"[TCBENCH] exported {shot}")
    except Exception as e:
        unreal.log(f"[TCBENCH] capture_export failed: {e}")


def tick(_dt):
    state["f"] += 1
    f = state["f"]
    if f == 2:
        q = PRESETS.get(PRESET, 2)
        cmd(f"sg.ViewDistanceQuality {q}")
        for g in ("AntiAliasingQuality", "ShadowQuality", "GlobalIlluminationQuality", "ReflectionQuality",
                  "PostProcessQuality", "TextureQuality", "EffectsQuality", "FoliageQuality", "ShadingQuality"):
            cmd(f"sg.{g} {q}")
        cmd("t.MaxFPS 0")
        cmd("r.VSync 0")
        if SP:
            cmd(f"r.ScreenPercentage {SP}")
    elif state["start"] is None:
        if f >= WARM and time.time() - state["t0"] >= WARM_SEC:
            state["start"] = f
            cmd("CsvProfile Start")
    else:
        g = f - state["start"]
        if g == FRAMES:
            cmd("CsvProfile Stop")
        elif g == FRAMES + 200:
            capture_begin()
        elif g == FRAMES + 260:
            capture_export()
        elif g == FRAMES + 600:
            cmd("quit")


unreal.register_slate_post_tick_callback(tick)
unreal.log(f"[TCBENCH] armed warm={WARM} frames={FRAMES} preset={PRESET}")
