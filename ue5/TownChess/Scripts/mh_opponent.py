"""Builds the TownChess opponent (a MetaHuman) with MetaHuman Creator's Python API (UE 5.8).

    UnrealEditor-Cmd TownChess.uproject -ExecutePythonScript=Scripts/mh_opponent.py -unattended -nosplash

Stages are chosen with TC_MH_STAGES (comma list, default "create,inspect"):
  create   - new MetaHumanCharacter asset /Game/TownChess/MetaHumans/<TC_MH_NAME> (kept if it exists), optionally
             duplicated from an Epic preset (TC_MH_PRESET); presets come rigged and textured, so no cloud step is needed
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

PATH = "/Game/TownChess/MetaHumans"
NAME = os.environ.get("TC_MH_NAME", "MH_Opponent")
PRESET = os.environ.get("TC_MH_PRESET", "")  # e.g. Walter: start from /MetaHumanCharacter/Optional/Presets/<name>
STAGES = [s.strip() for s in os.environ.get("TC_MH_STAGES", "create,inspect").split(",") if s.strip()]
EAL = unreal.EditorAssetLibrary


def log(*a):
    unreal.log("[TCMH] " + " ".join(str(x) for x in a))


def character():
    full = f"{PATH}/{NAME}"
    if EAL.does_asset_exist(full):
        return unreal.load_asset(full)
    if PRESET:
        ch = EAL.duplicate_asset(f"/MetaHumanCharacter/Optional/Presets/{PRESET}", full)
        EAL.save_loaded_asset(ch)
        log("created", full, "from preset", PRESET)
        return ch
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
            items = sorted({p.split(".")[0] for p in EAL.list_assets("/MetaHumanCharacter/Optional", recursive=True) if "/WI_" in p})
            log("wardrobe items", len(items))
            for it in items:
                if "/Grooms/" not in it or any(k in it for k in ("Hair_S", "Beard", "Eyebrows", "Mustache", "Peachfuzz")):
                    log("  ", it.replace("/MetaHumanCharacter/Optional/", ""))
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
        if "wardrobe" in STAGES:
            col = ch.internal_collection
            OPT = "/MetaHumanCharacter/Optional"
            picks = [("Outfits", f"{OPT}/Clothing/WI_DefaultGarment"),
                     ("Hair", f"{OPT}/Grooms/Bindings/Hair/WI_Hair_S_BuzzCut"),
                     ("Eyebrows", f"{OPT}/Grooms/Bindings/Eyebrows/WI_Eyebrows_L_Scraggly"),
                     ("Beard", f"{OPT}/Grooms/Bindings/Beards/WI_Beard_S_Stubble")]
            keys = {}
            for slot, path in picks:
                wi = unreal.load_asset(path)
                if not wi:
                    log("WARNING missing wardrobe item", path)
                    continue
                key = col.try_add_item_from_wardrobe_item(slot, wi)
                col.default_instance.try_add_slot_selection(unreal.MetaHumanPipelineSlotSelection(slot_name=slot, selected_item=key))
                keys[slot] = key
                log("wardrobe", slot, path.rsplit("/", 1)[1])
            sub.assemble_for_preview(character=ch)
            if "Outfits" in keys:
                params = col.default_instance.get_instance_parameters(item_path=unreal.MetaHumanPaletteItemPath(item_key=keys["Outfits"]))
                log("outfit params", [str(p.name) for p in params])
                drab = {"shirt": unreal.LinearColor(0.16, 0.15, 0.11, 1), "pant": unreal.LinearColor(0.1, 0.095, 0.08, 1)}
                for prm in params:
                    n = str(prm.name).lower()
                    for k, c in drab.items():
                        if k in n and "color" in n:
                            prm.set_color(value=c)
                            log("set", prm.name)
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
            try:
                sub.build_meta_human(character=ch, params=b)
            except RuntimeError as e:
                # Epic's face control rig emits "Cannot break link" errors during assembly although the build succeeds
                if "Cannot break link" not in str(e):
                    raise
                log("build finished with control-rig link warnings (harmless)")
            if not EAL.does_asset_exist(f"{PATH}/Built/{NAME}/BP_{NAME}"):
                raise RuntimeError("build produced no blueprint")
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
