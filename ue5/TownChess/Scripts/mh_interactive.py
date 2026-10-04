"""Run from the open editor (Tools > Execute Python Script...): MetaHuman cloud steps need the editor's own Epic login,
which a headless editor started over SSH cannot complete. Does skin, auto-rig, textures and the build for MH_Opponent,
then leaves the editor open. Close the MH_Opponent asset window first. The editor is busy for several minutes."""
import os

os.environ["TC_MH_STAGES"] = "body,skin,rig,textures,build"
os.environ["TC_QUIT"] = "0"
here = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(here, "mh_opponent.py")
with open(path, encoding="utf-8") as f:
    exec(compile(f.read(), path, "exec"), {"__name__": "__tc_mh__", "__file__": path})
import unreal  # noqa: E402
unreal.EditorDialog.show_message("TownChess", "MetaHuman opponent script finished - see the Output Log ([TCMH] lines).",
                                 unreal.AppMsgType.OK)
