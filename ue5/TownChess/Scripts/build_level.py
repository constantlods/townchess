"""Builds /Game/TownChess/L_Table, the playable level, with the shared scene builder in gameplay mode.

    UnrealEditor TownChess.uproject -ExecutePythonScript=Scripts/build_level.py -RenderOffscreen -unattended

Same room, lighting and props as the benchmark (ue5/TownChessBench/Scripts/build_scene.py); the chessboard is the
C++ ATCBoard actor, which takes its layout from the TownChess core.
"""
import os

os.environ.setdefault("TC_ROOT", "/Game/TownChess")
os.environ.setdefault("TC_LEVEL", "L_Table")
os.environ["TC_GAMEPLAY"] = "1"
here = os.path.dirname(os.path.abspath(__file__))
builder = os.path.normpath(os.path.join(here, "..", "..", "TownChessBench", "Scripts", "build_scene.py"))
with open(builder, encoding="utf-8") as f:
    code = compile(f.read(), builder, "exec")
exec(code, {"__name__": "__tc_build__", "__file__": builder})
