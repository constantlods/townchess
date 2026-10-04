"""Builds the TownChess opponent (a MetaHuman) with MetaHuman Creator's Python API (UE 5.8).

    UnrealEditor-Cmd TownChess.uproject -ExecutePythonScript=Scripts/mh_opponent.py -unattended -nosplash

Stages are chosen with TC_MH_STAGES (comma list, default "create,inspect"):
  create   - new MetaHumanCharacter asset /Game/TownChess/MetaHumans/MH_Opponent (kept if it exists)
  inspect  - log body constraint names and the stock wardrobe/groom items
  body     - gaunt, long-armed build
  skin     - pale, rough, worn skin
  rig      - cloud auto-rig (needs the editor's Epic login)
  textures - cloud texture synthesis (needs the login)
  build    - assemble with the UE Optimized pipeline into /Game/TownChess/MetaHumans/Built
"""
import os
import traceback

import unreal

PATH, NAME = "/Game/TownChess/MetaHumans", "MH_Opponent"
STAGES = [s.strip() for s in os.environ.get("TC_MH_STAGES", "create,inspect").split(",") if s.strip()]
EAL = unreal.EditorAssetLibrary


def log(*a):
    unreal.log("[TCMH] " + " ".join(str(x) for x in a))


def character():
    full = f"{PATH}/{NAME}"
    if EAL.does_asset_exist(full):
        return unreal.load_asset(full)
    ch = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        asset_name=NAME, package_path=PATH, asset_class=unreal.MetaHumanCharacter,
        factory=unreal.new_object(type=unreal.MetaHumanCharacterFactoryNew))
    EAL.save_loaded_asset(ch)
    log("created", full)
    return ch


def run():
    ch = character()
    sub = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
    if not sub.try_add_object_to_edit(ch):
        raise RuntimeError("cannot edit the character (is it open in an editor window?)")
    try:
        if "inspect" in STAGES:
            for c in sub.get_body_constraints(ch):
                log("body constraint", c.name, "active", c.is_active, "target", round(c.target_measurement, 1))
            for root in ("/MetaHumanCharacter/Optional/Clothing", "/MetaHumanCharacter/Optional/Grooms",
                         "/MetaHumanCharacter/Optional"):
                items = [p for p in EAL.list_assets(root, recursive=True) if "/WI_" in p]
                log("wardrobe under", root, len(items), sorted({p.split(".")[0] for p in items})[:60])
        if "body" in STAGES:
            # gaunt, long-limbed adult male (names from the "inspect" stage; cm unless noted)
            want = {"height": 183.0, "chest": 90.0, "waist": 72.0, "hip": 88.0, "upper_arm_length": 36.5,
                    "lower_arm_length": 28.0, "across_shoulder": 38.0, "bicep": 27.0, "forearm": 24.0, "wrist": 16.0,
                    "neck": 35.0, "fat": 0.0, "muscularity": 0.15}
            cons = sub.get_body_constraints(ch)
            for c in cons:
                key = str(c.name).lower().replace(" ", "_")
                if key in want:
                    c.is_active, c.target_measurement = True, want[key]
            sub.set_body_constraints(ch, cons)
            sub.commit_body_state(ch)
            log("body committed")
        if "skin" in STAGES:
            sp = unreal.MetaHumanCharacterSkinProperties()
            sp.u, sp.v, sp.roughness = 0.12, 0.35, 0.9  # pale, desaturated, matte
            ss = unreal.MetaHumanCharacterSkinSettings()
            ss.skin = sp
            sub.commit_skin_settings(ch, ss)
            log("skin committed")
        if "rig" in STAGES:
            r = unreal.MetaHumanCharacterAutoRiggingRequestParams()
            r.blocking, r.report_progress = True, False
            r.rig_type = unreal.MetaHumanRigType.JOINTS_ONLY
            sub.request_auto_rigging(ch, r)
            log("auto-rig requested; rig state", sub.get_rigging_state(ch) if hasattr(sub, "get_rigging_state") else "?")
        if "textures" in STAGES:
            t = unreal.MetaHumanCharacterTextureRequestParams()
            t.blocking, t.report_progress = True, False
            sub.request_texture_sources(ch, t)
            log("textures requested")
        if "build" in STAGES:
            b = unreal.MetaHumanCharacterEditorBuildParameters()
            b.pipeline_type = unreal.MetaHumanDefaultPipelineType.OPTIMIZED
            b.pipeline_quality = unreal.MetaHumanQualityLevel.HIGH
            b.absolute_build_path = f"{PATH}/Built"
            b.common_folder_path = f"{PATH}/Common"
            b.enable_wardrobe_item_validation = False
            sub.build_meta_human(character=ch, params=b)
            log("build done")
        EAL.save_loaded_asset(ch)
    finally:
        if sub.is_object_added_for_editing(ch):
            sub.remove_object_to_edit(ch)


try:
    run()
    log("OK", STAGES)
except Exception:
    log("FAILED\n" + traceback.format_exc())
finally:
    if os.environ.get("TC_QUIT", "1") == "1":
        unreal.SystemLibrary.quit_editor()
