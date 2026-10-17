"""Export the cinematic MetaHuman body's baked textures and mesh for ue5/tools/textures/skin.py.

    UnrealEditor-Cmd TownChess.uproject -ExecutePythonScript=Scripts/export_body.py -unattended -RenderOffscreen

Writes T_Body_{BC,N,SRMF}_VT.tga and SKM_Body.fbx to $TC_EXPORT_DIR (default C:/TownChess/assets/rs_export). These are
Epic MetaHuman content: they stay in the workspace, never in the repo.
"""
import os

import unreal

L = lambda *a: unreal.log("[TCEXPORT] " + " ".join(str(x) for x in a))
mhn = os.environ.get("TC_MH_NAME", "MH_Walter")
root = f"/Game/TownChess/MetaHumans/BuiltCine/{mhn}/Body"
out = os.environ.get("TC_EXPORT_DIR", "C:/TownChess/assets/rs_export")
os.makedirs(out, exist_ok=True)


def export(obj, path, exporter=None):
    t = unreal.AssetExportTask()
    t.set_editor_property("object", obj)
    t.set_editor_property("filename", path)
    t.set_editor_property("automated", True)
    t.set_editor_property("prompt", False)
    t.set_editor_property("replace_identical", True)
    if exporter:
        t.set_editor_property("exporter", exporter)
    ok = unreal.Exporter.run_asset_export_task(t)
    L("export", obj.get_name(), path, ok, os.path.exists(path) and os.path.getsize(path))


for n in ("T_Body_BC_VT", "T_Body_N_VT", "T_Body_SRMF_VT"):
    export(unreal.load_asset(f"{root}/Baked/{n}"), f"{out}/{n}.tga", unreal.TextureExporterTGA())
export(unreal.load_asset(f"{root}/SKM_{mhn}_BodyMesh"), f"{out}/SKM_Body.fbx", unreal.SkeletalMeshExporterFBX())
