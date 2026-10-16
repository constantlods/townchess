"""Builds the TownChess UE5 benchmark level from scratch (run inside the editor).

    UnrealEditor TownChessBench.uproject -ExecutePythonScript=Scripts/build_scene.py -RenderOffscreen -unattended

Inputs: CC0 Poly Haven assets fetched by ue5/tools/fetch_polyhaven.py into $TC_ASSETS (default ~/assets/polyhaven),
plus the engine's template mannequins copied into Content/Characters and Content/XRMannequins.
Output: /Game/Bench/L_Bench with the table, board, 32 pieces, hands, opponent, practical lamp and a dark room.
Re-running rebuilds everything, so the scene is reproducible.
"""
import math
import os
import struct
import tempfile
import traceback
import zlib

import unreal

ASSETS = os.path.expanduser(os.environ.get("TC_ASSETS", "~/assets/polyhaven"))
PROPS = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "props"))
ROOT = os.environ.get("TC_ROOT", "/Game/Bench")
LEVEL = os.environ.get("TC_LEVEL", "L_Bench")
# Gameplay mode (ue5/TownChess): the board and pieces are the C++ ATCBoard actor, driven by the core; seat-relative
# props are tagged so the game can mirror them when the player sits as Black.
GAMEPLAY = os.environ.get("TC_GAMEPLAY") == "1"
MIRROR_TAG = "TC_SeatMirror"


def tag(actors, name=MIRROR_TAG):
    for a in actors if isinstance(actors, (list, tuple)) else [actors]:
        tags = list(a.get_editor_property("tags"))
        tags.append(unreal.Name(name))
        a.set_editor_property("tags", tags)
AT = unreal.AssetToolsHelpers.get_asset_tools()
MEL = unreal.MaterialEditingLibrary
EAL = unreal.EditorAssetLibrary
EAS = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
LES = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)


def log(*a):
    unreal.log("[TCBENCH] " + " ".join(str(x) for x in a))


def setp(obj, name, value):
    """set_editor_property that survives property renames between engine versions (logs and continues)."""
    try:
        obj.set_editor_property(name, value)
        return True
    except Exception as e:
        log("WARNING property", type(obj).__name__, name, e)
        return False


# ---------------------------------------------------------------- import helpers

def import_file(path, dest, name=None):
    t = unreal.AssetImportTask()
    t.filename = path
    t.destination_path = dest
    if name:
        t.destination_name = name
    t.automated = True
    t.replace_existing = True
    t.save = False
    AT.import_asset_tasks([t])
    return [unreal.load_asset(p) for p in t.imported_object_paths]


def png(path, w, h, rgba):
    raw = b"".join(b"\x00" + bytes(rgba) * w for _ in range(h))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def setup_texture(tex, kind):
    if kind == "normal":
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        tex.set_editor_property("srgb", False)
    elif kind == "linear":
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS)
        tex.set_editor_property("srgb", False)
    elif kind == "gray":
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_GRAYSCALE)
        tex.set_editor_property("srgb", False)
    elif kind == "color":
        # explicit (pass C3): the importer guesses "normal map" for bluish images. rough_linen_diff (mean sRGB 145/171/205)
        # came in as TC_NORMALMAP + linear: BC5 keeps only R/G, so the patient's jacket rendered base colour (127, 129, 0)
        # "lime" and the Annotator's linen read yellow-green (materials audit: the jacket sleeves)
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_DEFAULT)
        tex.set_editor_property("srgb", True)


def import_texture(path, dest, name, kind):
    objs = import_file(path, dest, name)
    tex = objs[0] if objs else unreal.load_asset(f"{dest}/{name}")
    setup_texture(tex, kind)
    return tex


# ---------------------------------------------------------------- master material

def build_master_material(defaults):
    path = f"{ROOT}/Materials/M_TC_PBR"
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    m = AT.create_asset("M_TC_PBR", f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew())

    def expr(cls, x, y):
        return MEL.create_material_expression(m, cls, x, y)

    def scalar(name, val, x, y):
        e = expr(unreal.MaterialExpressionScalarParameter, x, y)
        e.set_editor_property("parameter_name", name)
        e.set_editor_property("default_value", val)
        return e

    def tex_param(name, tex, stype, x, y):
        e = expr(unreal.MaterialExpressionTextureSampleParameter2D, x, y)
        e.set_editor_property("parameter_name", name)
        e.set_editor_property("texture", tex)
        e.set_editor_property("sampler_type", stype)
        return e

    def mask(src, chans, x, y, pin=""):
        e = expr(unreal.MaterialExpressionComponentMask, x, y)
        for c in "rgba":
            e.set_editor_property(c, c in chans)
        MEL.connect_material_expressions(src, pin, e, "")
        return e

    def op(cls, a, b, x, y, pa="", pb=""):
        e = expr(cls, x, y)
        for v, pin, port in ((a, pa, "A"), (b, pb, "B")):
            if isinstance(v, (int, float)):
                e.set_editor_property("const_" + port.lower(), float(v))
            else:
                MEL.connect_material_expressions(v, pin, e, port)
        return e

    def pixel_footprint(x, y):
        P = unreal.MaterialExposedViewProperty
        def vp(*names):
            for n in names:
                if hasattr(P, n):
                    e = expr(unreal.MaterialExpressionViewProperty, x, y)
                    e.set_editor_property("property", getattr(P, n))
                    return mask(e, "r", x + 100, y)
            raise AttributeError(names)
        try:
            tanh = vp("MEVP_TAN_HALF_FIELD_OF_VIEW", "TAN_HALF_FIELD_OF_VIEW")
            vsz = vp("MEVP_VIEW_SIZE", "VIEW_SIZE")
        except AttributeError as e:
            log("WARNING master: no view property", e, "- detail fade / spec AA off")
            c = expr(unreal.MaterialExpressionConstant, x, y)
            c.set_editor_property("r", 0.0)
            return c
        depth = expr(unreal.MaterialExpressionPixelDepth, x, y + 100)
        a = op(unreal.MaterialExpressionMultiply, depth, tanh, x + 250, y)
        b = op(unreal.MaterialExpressionMultiply, a, 2.0, x + 350, y)
        return op(unreal.MaterialExpressionDivide, b, vsz, x + 450, y)

    uv = expr(unreal.MaterialExpressionTextureCoordinate, -1400, 0)
    tiling = scalar("Tiling", 1.0, -1400, 120)
    uvm = expr(unreal.MaterialExpressionMultiply, -1200, 0)
    MEL.connect_material_expressions(uv, "", uvm, "A")
    MEL.connect_material_expressions(tiling, "", uvm, "B")
    # C6: anisotropic tiling, UVScale.rg x Tiling (the player sleeve's cylindrical UVs run 31 cm round x 20 cm along)
    uvs = expr(unreal.MaterialExpressionVectorParameter, -1400, 200)
    uvs.set_editor_property("parameter_name", "UVScale")
    uvs.set_editor_property("default_value", unreal.LinearColor(1, 1, 1, 1))
    uvsm = mask(uvs, "rg", -1300, 200)
    uvm0, uvm = uvm, expr(unreal.MaterialExpressionMultiply, -1100, 60)
    MEL.connect_material_expressions(uvm0, "", uvm, "A")
    MEL.connect_material_expressions(uvsm, "", uvm, "B")
    # C6: world size of one rendered pixel at this surface (cm): depth x 2 tan(fov/2) / view width. Analytic, no
    # DDX/DDY (the pieces are Nanite). Drives the detail fade and the specular anti-aliasing below.
    pxw = pixel_footprint(-1400, 1500)

    bc = tex_param("BaseColor", defaults["white"], unreal.MaterialSamplerType.SAMPLERTYPE_COLOR, -900, -400)
    nm = tex_param("Normal", defaults["normal"], unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL, -900, 0)
    arm = tex_param("ARM", defaults["arm"], unreal.MaterialSamplerType.SAMPLERTYPE_MASKS, -900, 300)
    for s in (bc, nm, arm):
        MEL.connect_material_expressions(uvm, "", s, "UVs")

    tint = expr(unreal.MaterialExpressionVectorParameter, -900, -600)
    tint.set_editor_property("parameter_name", "Tint")
    tint.set_editor_property("default_value", unreal.LinearColor(1, 1, 1, 1))
    bcm = expr(unreal.MaterialExpressionMultiply, -500, -450)
    MEL.connect_material_expressions(bc, "RGB", bcm, "A")
    MEL.connect_material_expressions(tint, "", bcm, "B")

    # Layered wear on top of the scanned maps: a tiling grime mask (R macro blotches, G mid streaks, B micro smudge)
    # darkens/tints the colour and changes roughness, so surfaces stop reading as clean CG. GrimeThreshold 1 = off.
    guv = expr(unreal.MaterialExpressionMultiply, -1200, -800)
    MEL.connect_material_expressions(uv, "", guv, "A")
    MEL.connect_material_expressions(scalar("GrimeTiling", 1.0, -1400, -760), "", guv, "B")
    grime = tex_param("Grime", defaults["grime"], unreal.MaterialSamplerType.SAMPLERTYPE_MASKS, -1000, -900)
    MEL.connect_material_expressions(guv, "", grime, "UVs")
    gmix = expr(unreal.MaterialExpressionLinearInterpolate, -800, -1000)  # macro blotches, broken up by streaks
    MEL.connect_material_expressions(grime, "R", gmix, "A")
    MEL.connect_material_expressions(grime, "G", gmix, "B")
    MEL.connect_material_expressions(scalar("GrimeStreaks", 0.35, -1000, -1080), "", gmix, "Alpha")
    gsub = expr(unreal.MaterialExpressionSubtract, -650, -1000)
    MEL.connect_material_expressions(gmix, "", gsub, "A")
    MEL.connect_material_expressions(scalar("GrimeThreshold", 1.0, -800, -1080), "", gsub, "B")
    gmul = expr(unreal.MaterialExpressionMultiply, -500, -1000)
    MEL.connect_material_expressions(gsub, "", gmul, "A")
    MEL.connect_material_expressions(scalar("GrimeContrast", 3.0, -650, -1080), "", gmul, "B")
    gmask0 = expr(unreal.MaterialExpressionSaturate, -380, -1000)
    MEL.connect_material_expressions(gmul, "", gmask0, "")
    # C6: a per-asset wear mask in the mesh's own UVs (not tiled): R = extra grime (a sleeve's cuff and fold lines),
    # G = stains (StainColor x base colour). The default is black: no change for any other instance.
    wm = tex_param("WearMask", defaults["black"], unreal.MaterialSamplerType.SAMPLERTYPE_MASKS, -1000, -1300)
    MEL.connect_material_expressions(uv, "", wm, "UVs")
    wmr = op(unreal.MaterialExpressionMultiply, wm, scalar("WearGrime", 1.0, -1000, -1380), -800, -1300, pa="R")
    gmask = expr(unreal.MaterialExpressionSaturate, -300, -1100)
    MEL.connect_material_expressions(op(unreal.MaterialExpressionAdd, gmask0, wmr, -450, -1100), "", gmask, "")
    gcol = expr(unreal.MaterialExpressionVectorParameter, -500, -1200)
    gcol.set_editor_property("parameter_name", "GrimeColor")
    gcol.set_editor_property("default_value", unreal.LinearColor(0.32, 0.25, 0.17, 1))
    dirty = expr(unreal.MaterialExpressionMultiply, -350, -1150)
    MEL.connect_material_expressions(bcm, "", dirty, "A")
    MEL.connect_material_expressions(gcol, "", dirty, "B")
    bcf = expr(unreal.MaterialExpressionLinearInterpolate, -220, -500)
    MEL.connect_material_expressions(bcm, "", bcf, "A")
    MEL.connect_material_expressions(dirty, "", bcf, "B")
    MEL.connect_material_expressions(gmask, "", bcf, "Alpha")
    scol = expr(unreal.MaterialExpressionVectorParameter, -500, -1400)
    scol.set_editor_property("parameter_name", "StainColor")
    scol.set_editor_property("default_value", unreal.LinearColor(0.45, 0.3, 0.18, 1))
    stained = op(unreal.MaterialExpressionMultiply, bcf, scol, -150, -1300)
    bcs = expr(unreal.MaterialExpressionLinearInterpolate, -50, -1200)
    MEL.connect_material_expressions(bcf, "", bcs, "A")
    MEL.connect_material_expressions(stained, "", bcs, "B")
    MEL.connect_material_expressions(wm, "G", bcs, "Alpha")
    # Handling detail (pass C3, materials audit finding 2/3): blood.py's tileable T_HandlingGrime maps at their own
    # tiling, so untextured instances get relief and a varied gloss instead of one flat colour with one roughness.
    # Mask: R smudges, G scratches, B fingerprints, A lacquer chips. Off by default (strengths 0).
    duv = expr(unreal.MaterialExpressionMultiply, -1200, 800)
    MEL.connect_material_expressions(uv, "", duv, "A")
    MEL.connect_material_expressions(scalar("DetailTiling", 6.0, -1400, 840), "", duv, "B")
    dnm = tex_param("DetailNormal", defaults.get("detail_normal") or defaults["normal"], unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL, -1000, 800)
    dmk = tex_param("DetailMask", defaults.get("detail_mask") or defaults["arm"], unreal.MaterialSamplerType.SAMPLERTYPE_MASKS, -1000, 1000)
    for s in (dnm, dmk):
        MEL.connect_material_expressions(duv, "", s, "UVs")
    # smudges darken the colour a little (DetailDarken x R)
    ddk = expr(unreal.MaterialExpressionMultiply, -350, -650)
    MEL.connect_material_expressions(dmk, "R", ddk, "A")
    MEL.connect_material_expressions(scalar("DetailDarken", 0.0, -500, -700), "", ddk, "B")
    d1m = expr(unreal.MaterialExpressionOneMinus, -250, -650)
    MEL.connect_material_expressions(ddk, "", d1m, "")
    bcd = expr(unreal.MaterialExpressionMultiply, -120, -550)
    MEL.connect_material_expressions(bcs, "", bcd, "A")
    MEL.connect_material_expressions(d1m, "", bcd, "B")
    # C6 cavity term from ARM.R (AO): pockets darker (CavityDarken), duller (CavityRough) and with less F0
    # (CavitySpec), so a sub-pixel concave pocket (the rook crowns) reads dark instead of catching bounce/specular
    cav = expr(unreal.MaterialExpressionOneMinus, -700, 1600)
    MEL.connect_material_expressions(arm, "R", cav, "")
    cdk = op(unreal.MaterialExpressionMultiply, cav, scalar("CavityDarken", 0.0, -700, 1700), -550, 1600)
    cdk1 = expr(unreal.MaterialExpressionOneMinus, -420, 1600)
    MEL.connect_material_expressions(cdk, "", cdk1, "")
    bcc = op(unreal.MaterialExpressionMultiply, bcd, cdk1, 0, -500)
    MEL.connect_material_property(bcc, "", unreal.MaterialProperty.MP_BASE_COLOR)
    csp = op(unreal.MaterialExpressionMultiply, cav, scalar("CavitySpec", 0.0, -700, 1800), -550, 1800)
    csp1 = expr(unreal.MaterialExpressionOneMinus, -420, 1800)
    MEL.connect_material_expressions(csp, "", csp1, "")
    MEL.connect_material_property(op(unreal.MaterialExpressionMultiply, csp1, 0.5, -300, 1800), "", unreal.MaterialProperty.MP_SPECULAR)
    # C6 detail fade: full detail while one pixel covers < 1/DetailFadeInv cm, none at twice that (sub-pixel relief
    # only aliases into sparkle). DetailFadeInv 0 (default) = never fades.
    dfade = expr(unreal.MaterialExpressionSaturate, -900, 1500)
    MEL.connect_material_expressions(op(unreal.MaterialExpressionSubtract, 2.0,
                                        op(unreal.MaterialExpressionMultiply, pxw, scalar("DetailFadeInv", 0.0, -1100, 1600), -1000, 1500),
                                        -950, 1500), "", dfade, "")

    # Normal strength: lerp flat → sampled.
    flat = expr(unreal.MaterialExpressionConstant3Vector, -700, 120)
    flat.set_editor_property("constant", unreal.LinearColor(0, 0, 1, 1))
    nstr = scalar("NormalStrength", 1.0, -700, 200)
    nl = expr(unreal.MaterialExpressionLinearInterpolate, -450, 0)
    MEL.connect_material_expressions(flat, "", nl, "A")
    MEL.connect_material_expressions(nm, "RGB", nl, "B")
    MEL.connect_material_expressions(nstr, "", nl, "Alpha")
    # + detail: n + (d - (0,0,1)) x DetailNormalStrength, renormalised (a cheap whiteout-style blend)
    dsub = expr(unreal.MaterialExpressionSubtract, -700, 800)
    MEL.connect_material_expressions(dnm, "RGB", dsub, "A")
    MEL.connect_material_expressions(flat, "", dsub, "B")
    dmul = expr(unreal.MaterialExpressionMultiply, -550, 800)
    MEL.connect_material_expressions(dsub, "", dmul, "A")
    MEL.connect_material_expressions(op(unreal.MaterialExpressionMultiply, scalar("DetailNormalStrength", 0.0, -700, 900), dfade, -620, 900), "", dmul, "B")
    nadd = expr(unreal.MaterialExpressionAdd, -320, 100)
    MEL.connect_material_expressions(nl, "", nadd, "A")
    MEL.connect_material_expressions(dmul, "", nadd, "B")
    nnorm = expr(unreal.MaterialExpressionNormalize, -200, 100)
    MEL.connect_material_expressions(nadd, "", nnorm, "")
    MEL.connect_material_property(nnorm, "", unreal.MaterialProperty.MP_NORMAL)

    MEL.connect_material_property(arm, "R", unreal.MaterialProperty.MP_AMBIENT_OCCLUSION)
    # Roughness: ARM.G, or a separate roughness map (Poly Haven model textures) when UseRoughTex = 1
    # sampler types must match the textures' compression or the whole material fails to compile (renders the world grid)
    rtex = tex_param("RoughTex", defaults["gray"], unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_GRAYSCALE, -900, 700)
    MEL.connect_material_expressions(uvm, "", rtex, "UVs")
    rsel = expr(unreal.MaterialExpressionLinearInterpolate, -650, 380)
    MEL.connect_material_expressions(arm, "G", rsel, "A")
    MEL.connect_material_expressions(rtex, "R", rsel, "B")
    MEL.connect_material_expressions(scalar("UseRoughTex", 0.0, -800, 460), "", rsel, "Alpha")
    rs = scalar("RoughnessScale", 1.0, -700, 420)
    rm = expr(unreal.MaterialExpressionMultiply, -450, 380)
    MEL.connect_material_expressions(rsel, "", rm, "A")
    MEL.connect_material_expressions(rs, "", rm, "B")
    rg = expr(unreal.MaterialExpressionLinearInterpolate, -320, 380)  # grime is matte
    MEL.connect_material_expressions(rm, "", rg, "A")
    MEL.connect_material_expressions(scalar("GrimeRoughness", 0.85, -450, 300), "", rg, "B")
    MEL.connect_material_expressions(gmask, "", rg, "Alpha")
    # micro smudges/fingerprints: +- MicroRough around the base value from the grime B channel
    mc = expr(unreal.MaterialExpressionSubtract, -450, 470)
    MEL.connect_material_expressions(grime, "B", mc, "A")
    mc.set_editor_property("const_b", 0.5)
    mcs = expr(unreal.MaterialExpressionMultiply, -320, 470)
    MEL.connect_material_expressions(mc, "", mcs, "A")
    MEL.connect_material_expressions(scalar("MicroRough", 0.0, -450, 540), "", mcs, "B")
    radd = expr(unreal.MaterialExpressionAdd, -200, 400)
    MEL.connect_material_expressions(rg, "", radd, "A")
    MEL.connect_material_expressions(mcs, "", radd, "B")
    # handling detail: smudges and scratches dull the surface, fingerprints (skin oil) polish it: + DetailRough x (R + G - 0.5 B)
    drs = expr(unreal.MaterialExpressionAdd, -700, 1000)
    MEL.connect_material_expressions(dmk, "R", drs, "A")
    MEL.connect_material_expressions(dmk, "G", drs, "B")
    dfp = expr(unreal.MaterialExpressionMultiply, -700, 1100)
    MEL.connect_material_expressions(dmk, "B", dfp, "A")
    dfp.set_editor_property("const_b", 0.5)
    drd = expr(unreal.MaterialExpressionSubtract, -550, 1000)
    MEL.connect_material_expressions(drs, "", drd, "A")
    MEL.connect_material_expressions(dfp, "", drd, "B")
    drm = expr(unreal.MaterialExpressionMultiply, -400, 1000)
    MEL.connect_material_expressions(drd, "", drm, "A")
    MEL.connect_material_expressions(op(unreal.MaterialExpressionMultiply, scalar("DetailRough", 0.0, -550, 1100), dfade, -480, 1100), "", drm, "B")
    radd2 = expr(unreal.MaterialExpressionAdd, -150, 500)
    MEL.connect_material_expressions(radd, "", radd2, "A")
    MEL.connect_material_expressions(drm, "", radd2, "B")
    crg = op(unreal.MaterialExpressionMultiply, cav, scalar("CavityRough", 0.0, -700, 1900), -550, 1900)
    rsat = expr(unreal.MaterialExpressionSaturate, -100, 400)
    MEL.connect_material_expressions(op(unreal.MaterialExpressionAdd, radd2, crg, -120, 520), "", rsat, "")
    # C6 specular anti-aliasing: alpha^2 + SpecAA x footprint^2 (a pixel-sized NDF widening, Kaplanyan-style but from
    # the analytic footprint instead of normal derivatives). SpecAA 0 (default) = sqrt(r^2) = r.
    r2 = op(unreal.MaterialExpressionMultiply, rsat, rsat, 0, 400)
    k2 = op(unreal.MaterialExpressionMultiply, op(unreal.MaterialExpressionMultiply, pxw, pxw, -150, 1500),
            scalar("SpecAA", 0.0, -150, 1600), 0, 1500)
    rk = expr(unreal.MaterialExpressionSaturate, 100, 450)
    MEL.connect_material_expressions(op(unreal.MaterialExpressionAdd, r2, k2, 50, 450), "", rk, "")
    rsq = expr(unreal.MaterialExpressionSquareRoot, 200, 450)
    MEL.connect_material_expressions(rk, "", rsq, "")
    MEL.connect_material_property(rsq, "", unreal.MaterialProperty.MP_ROUGHNESS)
    ms = scalar("MetallicScale", 0.0, -700, 560)
    mm = expr(unreal.MaterialExpressionMultiply, -450, 540)
    # metalness: ARM.B, or a Poly Haven model's own metal map when UseMetalTex = 1 (bed frame, wheelchair: pass C3)
    mtex = tex_param("MetalTex", defaults["gray"], unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_GRAYSCALE, -900, 1300)
    MEL.connect_material_expressions(uvm, "", mtex, "UVs")
    msel = expr(unreal.MaterialExpressionLinearInterpolate, -650, 620)
    MEL.connect_material_expressions(arm, "B", msel, "A")
    MEL.connect_material_expressions(mtex, "R", msel, "B")
    MEL.connect_material_expressions(scalar("UseMetalTex", 0.0, -800, 700), "", msel, "Alpha")
    MEL.connect_material_expressions(msel, "", mm, "A")
    MEL.connect_material_expressions(ms, "", mm, "B")
    MEL.connect_material_property(mm, "", unreal.MaterialProperty.MP_METALLIC)

    MEL.recompile_material(m)
    EAL.save_loaded_asset(m)
    return m


def emissive_material(name, color, strength):
    path = f"{ROOT}/Materials/{name}"
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    m = AT.create_asset(name, f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    c = MEL.create_material_expression(m, unreal.MaterialExpressionConstant3Vector, -400, 0)
    c.set_editor_property("constant", unreal.LinearColor(color[0] * strength, color[1] * strength, color[2] * strength, 1))
    MEL.connect_material_property(c, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    MEL.recompile_material(m)
    EAL.save_loaded_asset(m)
    return m


def marker_material():
    """M_TC_Marker: unlit translucent disc for the board's square markers. Color (vector parameter): rgb = tint,
    a = strength; the edge fades out radially, so a marker reads as light on the wood, not a cream sticker."""
    name = "M_TC_Marker"
    path = f"{ROOT}/Materials/{name}"
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    m = AT.create_asset(name, f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
    col = MEL.create_material_expression(m, unreal.MaterialExpressionVectorParameter, -900, 0)
    col.set_editor_property("parameter_name", "Color")
    col.set_editor_property("default_value", unreal.LinearColor(0.9, 0.8, 0.55, 0.4))
    glow = MEL.create_material_expression(m, unreal.MaterialExpressionMultiply, -500, -150)
    glow.set_editor_property("const_b", 1.6)
    MEL.connect_material_expressions(col, "", glow, "A")
    MEL.connect_material_property(glow, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    uv = MEL.create_material_expression(m, unreal.MaterialExpressionTextureCoordinate, -1100, 200)
    centre = MEL.create_material_expression(m, unreal.MaterialExpressionConstant2Vector, -1100, 320)
    centre.set_editor_property("r", 0.5)
    centre.set_editor_property("g", 0.5)
    dist = MEL.create_material_expression(m, unreal.MaterialExpressionDistance, -900, 250)
    MEL.connect_material_expressions(uv, "", dist, "A")
    MEL.connect_material_expressions(centre, "", dist, "B")
    d2 = MEL.create_material_expression(m, unreal.MaterialExpressionMultiply, -750, 250)
    d2.set_editor_property("const_b", 2.0)
    MEL.connect_material_expressions(dist, "", d2, "A")
    inv = MEL.create_material_expression(m, unreal.MaterialExpressionOneMinus, -620, 250)
    MEL.connect_material_expressions(d2, "", inv, "")
    sat = MEL.create_material_expression(m, unreal.MaterialExpressionSaturate, -500, 250)
    MEL.connect_material_expressions(inv, "", sat, "")
    soft = MEL.create_material_expression(m, unreal.MaterialExpressionPower, -380, 250)
    soft.set_editor_property("const_exponent", 1.6)
    MEL.connect_material_expressions(sat, "", soft, "Base")
    # strength from the parameter's own alpha pin (its default output is RGB only: masking A from it failed to compile
    # and the markers fell back to the world-grid material, pass 49)
    op = MEL.create_material_expression(m, unreal.MaterialExpressionMultiply, -250, 200)
    MEL.connect_material_expressions(soft, "", op, "A")
    MEL.connect_material_expressions(col, "A", op, "B")
    MEL.connect_material_property(op, "", unreal.MaterialProperty.MP_OPACITY)
    MEL.recompile_material(m)
    errs = MEL.get_statistics(m) if hasattr(MEL, "get_statistics") else None
    log("marker material compiled", errs)
    EAL.save_loaded_asset(m)
    return m


FONTS = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "fonts"))


def import_font(ttf, name, legacy_size=32):
    """Runtime font from one of our OFL fonts (ue5/assets/fonts) for the clipboard's canvas text."""
    dest = f"{ROOT}/Fonts"
    objs = import_file(os.path.join(FONTS, ttf), dest, name + "_Face")
    face = next((o for o in objs if isinstance(o, unreal.FontFace)), None) or unreal.load_asset(f"{dest}/{name}_Face")
    if not isinstance(face, unreal.FontFace):
        log("WARNING font face import failed", ttf, objs)
        return None
    path = f"{dest}/{name}"
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    font = AT.create_asset(name, dest, unreal.Font, unreal.FontFactory())
    try:
        font.set_editor_property("font_cache_type", unreal.FontCacheType.RUNTIME)
        fd = unreal.FontData()
        fd.set_editor_property("font_face_asset", face)
        entry = unreal.TypefaceEntry()
        entry.set_editor_property("name", "Regular")
        entry.set_editor_property("font", fd)
        tf = unreal.Typeface()
        tf.set_editor_property("fonts", [entry])
        cf = unreal.CompositeFont()
        cf.set_editor_property("default_typeface", tf)
        font.set_editor_property("composite_font", cf)
        font.set_editor_property("legacy_font_size", legacy_size)
    except Exception as e:
        log("WARNING font setup failed", name, e)
        return None
    EAL.save_loaded_asset(font)
    log("font", name, "from", ttf)
    return font


def paper_material(form_tex=None):
    """Paper for the clipboard sheet: the game draws into the 'Sheet' render target; a little emission keeps pencil
    legible when the sheet is raised out of the lamp's cone (a reading light does the rest).
    C4 (board/environment, clipboard block): with form_tex (forms.py T_PaperForm_BaseColor) the record is printed on the
    same aged stock as the patient forms under it: the form sampled at a fixed coarse mip (32 x 45 px: its stains and
    yellowing, none of its text) multiplies the sheet, which also takes the flat 0.8 cream down to ~0.5, so the sheet on
    the table no longer reads as the frame's palest slab."""
    path = f"{ROOT}/Materials/M_TC_Paper"
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    m = AT.create_asset("M_TC_Paper", f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew())
    t = MEL.create_material_expression(m, unreal.MaterialExpressionTextureSampleParameter2D, -600, 0)
    t.set_editor_property("parameter_name", "Sheet")
    t.set_editor_property("texture", unreal.load_asset("/Engine/EngineResources/WhiteSquareTexture"))
    base = t
    # C8b (judge run 6 V5 #7, header printed twice "WARD - BATIENTRECORD"): the fixed-mip sample was not honoured, so the
    # form's full-resolution text multiplied the record and its typed header landed under the record's own "WARD B".
    # form_tex is now a text-free copy of the stock (the form capped at 64 px on import: toning and stains only).
    if form_tex:
        f = MEL.create_material_expression(m, unreal.MaterialExpressionTextureSample, -600, -250)
        f.set_editor_property("texture", form_tex)
        base = MEL.create_material_expression(m, unreal.MaterialExpressionMultiply, -380, -100)
        MEL.connect_material_expressions(t, "RGB", base, "A")
        MEL.connect_material_expressions(f, "RGB", base, "B")
    MEL.connect_material_property(base, "RGB" if base is t else "", unreal.MaterialProperty.MP_BASE_COLOR)
    k = MEL.create_material_expression(m, unreal.MaterialExpressionMultiply, -300, 200)
    MEL.connect_material_expressions(t, "RGB", k, "A")
    k.set_editor_property("const_b", 0.12)
    MEL.connect_material_property(k, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    r = MEL.create_material_expression(m, unreal.MaterialExpressionConstant, -300, 350)
    r.set_editor_property("r", 0.9)
    MEL.connect_material_property(r, "", unreal.MaterialProperty.MP_ROUGHNESS)
    MEL.recompile_material(m)
    EAL.save_loaded_asset(m)
    return m


def blood_decal_material(grime_tex):
    """Dried blood: blotches from our grime mask, fading towards the decal's edge; projected onto table and board."""
    path = f"{ROOT}/Materials/M_TC_BloodDecal"
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    m = AT.create_asset("M_TC_BloodDecal", f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew())
    # blend mode before the domain: a decal domain on the default opaque blend compiles once and logs "Failed to compile
    # Material for platform PCD3D_SM6" (C6 report), although the final material is fine
    m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
    m.set_editor_property("material_domain", unreal.MaterialDomain.MD_DEFERRED_DECAL)
    E = lambda cls, x, y: MEL.create_material_expression(m, cls, x, y)
    uv = E(unreal.MaterialExpressionTextureCoordinate, -1200, 0)
    t = E(unreal.MaterialExpressionTextureSample, -900, 0)
    t.set_editor_property("texture", grime_tex)
    t.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
    MEL.connect_material_expressions(uv, "", t, "UVs")
    c = E(unreal.MaterialExpressionConstant2Vector, -1200, 200)
    c.set_editor_property("r", 0.5); c.set_editor_property("g", 0.5)
    d = E(unreal.MaterialExpressionDistance, -900, 250)
    MEL.connect_material_expressions(uv, "", d, "A")
    MEL.connect_material_expressions(c, "", d, "B")
    inv = E(unreal.MaterialExpressionOneMinus, -700, 250)
    d2 = E(unreal.MaterialExpressionMultiply, -800, 250)
    MEL.connect_material_expressions(d, "", d2, "A"); d2.set_editor_property("const_b", 2.0)
    MEL.connect_material_expressions(d2, "", inv, "")
    mul = E(unreal.MaterialExpressionMultiply, -550, 100)
    MEL.connect_material_expressions(t, "R", mul, "A")
    MEL.connect_material_expressions(inv, "", mul, "B")
    sub = E(unreal.MaterialExpressionSubtract, -420, 100)
    MEL.connect_material_expressions(mul, "", sub, "A"); sub.set_editor_property("const_b", 0.32)
    k = E(unreal.MaterialExpressionMultiply, -300, 100)
    MEL.connect_material_expressions(sub, "", k, "A"); k.set_editor_property("const_b", 4.0)
    sat = E(unreal.MaterialExpressionSaturate, -180, 100)
    MEL.connect_material_expressions(k, "", sat, "")
    MEL.connect_material_property(sat, "", unreal.MaterialProperty.MP_OPACITY)
    col = E(unreal.MaterialExpressionConstant3Vector, -300, -150)
    col.set_editor_property("constant", unreal.LinearColor(0.09, 0.008, 0.006, 1))
    MEL.connect_material_property(col, "", unreal.MaterialProperty.MP_BASE_COLOR)
    r = E(unreal.MaterialExpressionConstant, -300, 300); r.set_editor_property("r", 0.45)
    MEL.connect_material_property(r, "", unreal.MaterialProperty.MP_ROUGHNESS)
    MEL.recompile_material(m)
    EAL.save_loaded_asset(m)
    return m


TEXTURES_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "textures"))


def board_squares_material(defaults):
    """The board's playing surface: 8 x 8 squares from UV0 (0..1 over the squares), alternating maple and dark walnut
    scans with a per-square grain offset, dark seams between squares, our grime layer and a darker dark-square tint.
    CheckerFlip swaps the parity if the import flipped V (a1 must be dark)."""
    def tex_maps(name):
        d = os.path.join(ASSETS, "textures", name)
        if not os.path.isdir(d):
            return None
        maps = {}
        for f in sorted(os.listdir(d)):
            stem = os.path.splitext(f)[0]
            if stem.endswith("_diff"):
                maps["d"] = import_texture(os.path.join(d, f), f"{ROOT}/Textures/{name}", "T_" + stem, "color")
            elif stem.endswith("_nor_dx"):
                maps["n"] = import_texture(os.path.join(d, f), f"{ROOT}/Textures/{name}", "T_" + stem, "normal")
            elif stem.endswith("_arm"):
                maps["a"] = import_texture(os.path.join(d, f), f"{ROOT}/Textures/{name}", "T_" + stem, "linear")
        return maps if "d" in maps else None
    light, dark = tex_maps("white_maple_veneer"), tex_maps("dark_wood")
    if not (light and dark):
        log("WARNING board woods missing (run fetch_polyhaven.py)")
        return None
    path = f"{ROOT}/Materials/M_TC_BoardSquares"
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    m = AT.create_asset("M_TC_BoardSquares", f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew())
    E = lambda cls, x, y: MEL.create_material_expression(m, cls, x, y)
    C = MEL.connect_material_expressions
    def scalar(name, v, x, y):
        e = E(unreal.MaterialExpressionScalarParameter, x, y); e.set_editor_property("parameter_name", name); e.set_editor_property("default_value", v); return e
    def k(v, x, y):
        e = E(unreal.MaterialExpressionConstant, x, y); e.set_editor_property("r", v); return e
    lp = E(unreal.MaterialExpressionLocalPosition, -2800, 0)
    lxy = E(unreal.MaterialExpressionComponentMask, -2650, 0); lxy.set_editor_property("r", True); lxy.set_editor_property("g", True); C(lp, "", lxy, "")
    lo = E(unreal.MaterialExpressionAdd, -2520, 0); C(lxy, "", lo, "A"); lo.set_editor_property("const_b", 23.2)  # 4 squares x 5.8 cm
    uv = E(unreal.MaterialExpressionDivide, -2400, 0); C(lo, "", uv, "A"); uv.set_editor_property("const_b", 46.4)  # 0..1 over the 8 x 8 squares
    uv8 = E(unreal.MaterialExpressionMultiply, -2200, 0); C(uv, "", uv8, "A"); uv8.set_editor_property("const_b", 8.0)
    cell = E(unreal.MaterialExpressionFloor, -2000, 0); C(uv8, "", cell, "")
    fx = E(unreal.MaterialExpressionComponentMask, -1850, -60); fx.set_editor_property("r", True); C(cell, "", fx, "")
    fy = E(unreal.MaterialExpressionComponentMask, -1850, 60); fy.set_editor_property("g", True); C(cell, "", fy, "")
    sm = E(unreal.MaterialExpressionAdd, -1700, 0); C(fx, "", sm, "A"); C(fy, "", sm, "B")
    sm2 = E(unreal.MaterialExpressionAdd, -1580, 0); C(sm, "", sm2, "A"); C(scalar("CheckerFlip", 0.0, -1700, 120), "", sm2, "B")
    par = E(unreal.MaterialExpressionFmod, -1450, 0); C(sm2, "", par, "A"); C(k(2.0, -1580, 120), "", par, "B")
    # per-square grain offset so no two squares share the same piece of wood
    jit = E(unreal.MaterialExpressionMultiply, -1700, 260); C(cell, "", jit, "A"); jit.set_editor_property("const_b", 0.371)
    tuv = E(unreal.MaterialExpressionMultiply, -1700, 380); C(uv, "", tuv, "A"); tuv.set_editor_property("const_b", 2.0)
    suv = E(unreal.MaterialExpressionAdd, -1550, 320); C(tuv, "", suv, "A"); C(jit, "", suv, "B")
    def samp(t, stype, x, y):
        e = E(unreal.MaterialExpressionTextureSample, x, y); e.set_editor_property("texture", t); e.set_editor_property("sampler_type", stype); C(suv, "", e, "UVs"); return e
    COL, NRM, MSK = unreal.MaterialSamplerType.SAMPLERTYPE_COLOR, unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL, unreal.MaterialSamplerType.SAMPLERTYPE_MASKS
    ld, dd = samp(light["d"], COL, -1300, -400), samp(dark["d"], COL, -1300, -200)
    tint_l = E(unreal.MaterialExpressionVectorParameter, -1300, -560); tint_l.set_editor_property("parameter_name", "LightTint"); tint_l.set_editor_property("default_value", unreal.LinearColor(0.82, 0.66, 0.46, 1))
    tint_d = E(unreal.MaterialExpressionVectorParameter, -1300, -60); tint_d.set_editor_property("parameter_name", "DarkTint"); tint_d.set_editor_property("default_value", unreal.LinearColor(0.42, 0.28, 0.18, 1))
    lm = E(unreal.MaterialExpressionMultiply, -1100, -450); C(ld, "RGB", lm, "A"); C(tint_l, "", lm, "B")
    dm = E(unreal.MaterialExpressionMultiply, -1100, -200); C(dd, "RGB", dm, "A"); C(tint_d, "", dm, "B")
    col = E(unreal.MaterialExpressionLinearInterpolate, -900, -300); C(lm, "", col, "A"); C(dm, "", col, "B"); C(par, "", col, "Alpha")
    # seams: distance to the nearest square edge
    fr = E(unreal.MaterialExpressionFrac, -2000, 600); C(uv8, "", fr, "")
    om = E(unreal.MaterialExpressionOneMinus, -1850, 700); C(fr, "", om, "")
    mn = E(unreal.MaterialExpressionMin, -1700, 650); C(fr, "", mn, "A"); C(om, "", mn, "B")
    mx = E(unreal.MaterialExpressionComponentMask, -1550, 600); mx.set_editor_property("r", True); C(mn, "", mx, "")
    my = E(unreal.MaterialExpressionComponentMask, -1550, 700); my.set_editor_property("g", True); C(mn, "", my, "")
    edge = E(unreal.MaterialExpressionMin, -1400, 650); C(mx, "", edge, "A"); C(my, "", edge, "B")
    seam = E(unreal.MaterialExpressionSmoothStep, -1250, 650); C(edge, "", seam, "Value"); C(k(0.006, -1400, 760), "", seam, "Min"); C(k(0.022, -1400, 820), "", seam, "Max")
    seamc = E(unreal.MaterialExpressionLinearInterpolate, -1050, 600); C(k(0.3, -1250, 760), "", seamc, "A"); C(k(1.0, -1250, 820), "", seamc, "B"); C(seam, "", seamc, "Alpha")
    col2 = E(unreal.MaterialExpressionMultiply, -750, -250); C(col, "", col2, "A"); C(seamc, "", col2, "B")
    # grime: blotches and streaks from our mask, darker brown, matte
    guv = E(unreal.MaterialExpressionMultiply, -1300, 900); C(uv, "", guv, "A"); guv.set_editor_property("const_b", 1.6)
    gt = E(unreal.MaterialExpressionTextureSample, -1100, 900); gt.set_editor_property("texture", defaults["grime"]); gt.set_editor_property("sampler_type", MSK); C(guv, "", gt, "UVs")
    gs = E(unreal.MaterialExpressionSubtract, -900, 900); C(gt, "R", gs, "A"); gs.set_editor_property("const_b", 0.38)
    gm = E(unreal.MaterialExpressionMultiply, -780, 900); C(gs, "", gm, "A"); gm.set_editor_property("const_b", 2.4)
    g = E(unreal.MaterialExpressionSaturate, -660, 900); C(gm, "", g, "")
    dirty = E(unreal.MaterialExpressionMultiply, -600, -100); C(col2, "", dirty, "A"); C(k(0.45, -750, -60), "", dirty, "B")
    fin = E(unreal.MaterialExpressionLinearInterpolate, -400, -200); C(col2, "", fin, "A"); C(dirty, "", fin, "B"); C(g, "", fin, "Alpha")
    MEL.connect_material_property(fin, "", unreal.MaterialProperty.MP_BASE_COLOR)
    if "n" in light and "n" in dark:
        ln_, dn_ = samp(light["n"], NRM, -1300, 200), samp(dark["n"], NRM, -1300, 360)
        nl = E(unreal.MaterialExpressionLinearInterpolate, -900, 250); C(ln_, "RGB", nl, "A"); C(dn_, "RGB", nl, "B"); C(par, "", nl, "Alpha")
        MEL.connect_material_property(nl, "", unreal.MaterialProperty.MP_NORMAL)
    if "a" in light and "a" in dark:
        la, da = samp(light["a"], MSK, -1300, 500), samp(dark["a"], MSK, -1300, 650)
        rl = E(unreal.MaterialExpressionLinearInterpolate, -900, 520); C(la, "G", rl, "A"); C(da, "G", rl, "B"); C(par, "", rl, "Alpha")
        rr = E(unreal.MaterialExpressionLinearInterpolate, -700, 520); C(rl, "", rr, "A"); C(k(0.9, -900, 640), "", rr, "B"); C(g, "", rr, "Alpha")
        MEL.connect_material_property(rr, "", unreal.MaterialProperty.MP_ROUGHNESS)
    MEL.recompile_material(m)
    EAL.save_loaded_asset(m)
    return m


def blood_decals():
    """Decal materials from our generated blood (ue5/tools/textures/blood.py): colour+coverage, relief and gloss maps,
    darkened towards old dried blood. Returns {variant: material instance}."""
    path = f"{ROOT}/Materials/M_TC_Blood"
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    m = AT.create_asset("M_TC_Blood", f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew())
    # blend mode before the domain: a decal domain on the default opaque blend compiles once and logs "Failed to compile
    # Material for platform PCD3D_SM6" (C6 report), although the final material is fine
    m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
    m.set_editor_property("material_domain", unreal.MaterialDomain.MD_DEFERRED_DECAL)
    E = lambda cls, x, y: MEL.create_material_expression(m, cls, x, y)
    def tex(name, stype, x, y):
        e = E(unreal.MaterialExpressionTextureSampleParameter2D, x, y)
        e.set_editor_property("parameter_name", name)
        e.set_editor_property("sampler_type", stype)
        return e
    white = unreal.load_asset("/Engine/EngineResources/WhiteSquareTexture")
    bc = tex("BaseColor", unreal.MaterialSamplerType.SAMPLERTYPE_COLOR, -800, -200)
    bc.set_editor_property("texture", white)
    nm = tex("Normal", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL, -800, 100)
    nm.set_editor_property("texture", unreal.load_asset("/Engine/EngineMaterials/DefaultNormal"))
    rg = tex("Roughness", unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_GRAYSCALE, -800, 350)
    rg.set_editor_property("texture", unreal.load_asset("/Engine/EngineResources/Black"))
    age = E(unreal.MaterialExpressionScalarParameter, -800, -380)
    age.set_editor_property("parameter_name", "Darken")
    age.set_editor_property("default_value", 0.7)  # towards dried brown
    mul = E(unreal.MaterialExpressionMultiply, -500, -250)
    MEL.connect_material_expressions(bc, "RGB", mul, "A")
    MEL.connect_material_expressions(age, "", mul, "B")
    MEL.connect_material_property(mul, "", unreal.MaterialProperty.MP_BASE_COLOR)
    # fade to nothing towards the decal's edges, so no mark can ever read as a square
    uvd = E(unreal.MaterialExpressionTextureCoordinate, -1200, 500)
    ctr = E(unreal.MaterialExpressionConstant2Vector, -1200, 600); ctr.set_editor_property("r", 0.5); ctr.set_editor_property("g", 0.5)
    dst = E(unreal.MaterialExpressionDistance, -1050, 550); MEL.connect_material_expressions(uvd, "", dst, "A"); MEL.connect_material_expressions(ctr, "", dst, "B")
    fsub = E(unreal.MaterialExpressionSubtract, -900, 550); MEL.connect_material_expressions(dst, "", fsub, "A"); fsub.set_editor_property("const_b", 0.5)
    fneg = E(unreal.MaterialExpressionMultiply, -780, 550); MEL.connect_material_expressions(fsub, "", fneg, "A"); fneg.set_editor_property("const_b", -8.0)
    fsat = E(unreal.MaterialExpressionSaturate, -660, 550); MEL.connect_material_expressions(fneg, "", fsat, "")
    op = E(unreal.MaterialExpressionMultiply, -540, 450); MEL.connect_material_expressions(bc, "A", op, "A"); MEL.connect_material_expressions(fsat, "", op, "B")
    MEL.connect_material_property(op, "", unreal.MaterialProperty.MP_OPACITY)
    # (the generated relief map shaded the blood near-black under the lamp; colour + gloss only for now)
    # thick blood is glossy, but a near-mirror reflects the dark room and reads black: keep it satin (0.32..0.8)
    rs = E(unreal.MaterialExpressionMultiply, -550, 350); C2 = MEL.connect_material_expressions
    C2(rg, "R", rs, "A"); rs.set_editor_property("const_b", 0.48)
    ra = E(unreal.MaterialExpressionAdd, -420, 350); C2(rs, "", ra, "A"); ra.set_editor_property("const_b", 0.32)
    MEL.connect_material_property(ra, "", unreal.MaterialProperty.MP_ROUGHNESS)
    MEL.recompile_material(m)
    EAL.save_loaded_asset(m)
    out = {}
    d = os.path.join(TEXTURES_DIR, "blood")
    for v in ("Spatter", "Pool", "Smear", "Drips"):
        maps = {}
        for kind, param, tkind in (("BaseColor", "BaseColor", "color"), ("Normal", "Normal", "normal"), ("Roughness", "Roughness", "gray")):
            f = os.path.join(d, f"T_Blood_{v}_{kind}.png")
            if os.path.exists(f):
                maps[param] = import_texture(f, f"{ROOT}/Textures/Blood", f"T_Blood_{v}_{kind}", tkind)
        if "BaseColor" not in maps:
            continue
        name = f"MI_Blood_{v}"
        if EAL.does_asset_exist(f"{ROOT}/Materials/{name}"):
            EAL.delete_asset(f"{ROOT}/Materials/{name}")
        mi = AT.create_asset(name, f"{ROOT}/Materials", unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        MEL.set_material_instance_parent(mi, m)
        for k, t in maps.items():
            MEL.set_material_instance_texture_parameter_value(mi, k, t)
        MEL.update_material_instance(mi)
        EAL.save_loaded_asset(mi)
        out[v] = mi
    # non-blood table wear from ue5/tools/textures/stains.py (mug rings, handled grime): same decal material
    sd = os.path.join(TEXTURES_DIR, "stains")
    for v in ("Ring", "Dirt", "Scratch"):
        f = os.path.join(sd, f"T_Stain_{v}_BaseColor.png")
        if not os.path.exists(f):
            continue
        name = f"MI_Stain_{v}"
        if EAL.does_asset_exist(f"{ROOT}/Materials/{name}"):
            EAL.delete_asset(f"{ROOT}/Materials/{name}")
        mi = AT.create_asset(name, f"{ROOT}/Materials", unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        MEL.set_material_instance_parent(mi, m)
        MEL.set_material_instance_texture_parameter_value(mi, "BaseColor", import_texture(f, f"{ROOT}/Textures/Stains", f"T_Stain_{v}_BaseColor", "color"))
        rf = os.path.join(sd, f"T_Stain_{v}_Roughness.png")
        if os.path.exists(rf):
            MEL.set_material_instance_texture_parameter_value(mi, "Roughness", import_texture(rf, f"{ROOT}/Textures/Stains", f"T_Stain_{v}_Roughness", "gray"))
        MEL.set_material_instance_scalar_parameter_value(mi, "Darken", 1.0)  # already the right colour
        MEL.update_material_instance(mi)
        EAL.save_loaded_asset(mi)
        out[v] = mi
    log("blood decals", sorted(out))
    return out


def hand_decal_materials():
    """Veins (normal only, opacity = vein mask) and dirt (colour + roughness) for the backs of the player's hands
    (ue5/tools/textures/hands.py). Two materials, because a translucent decal shares one opacity for every channel."""
    d = os.path.join(TEXTURES_DIR, "hands")
    if not os.path.exists(os.path.join(d, "T_HandVeins_Normal.png")):
        return None
    T = lambda f, n, k: import_texture(os.path.join(d, f), f"{ROOT}/Textures/Hands", n, k)
    veins_n, veins_m = T("T_HandVeins_Normal.png", "T_HandVeins_Normal", "normal"), T("T_HandVeins_Mask.png", "T_HandVeins_Mask", "gray")
    dirt_c, dirt_r = T("T_HandDirt_BaseColor.png", "T_HandDirt_BaseColor", "color"), T("T_HandDirt_Roughness.png", "T_HandDirt_Roughness", "gray")
    out = {}
    for name in ("M_TC_HandVeins", "M_TC_HandDirt"):
        path = f"{ROOT}/Materials/{name}"
        if EAL.does_asset_exist(path):
            EAL.delete_asset(path)
        m = AT.create_asset(name, f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew())
        m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
        m.set_editor_property("material_domain", unreal.MaterialDomain.MD_DEFERRED_DECAL)
        def samp(t, st, x, y):
            e = MEL.create_material_expression(m, unreal.MaterialExpressionTextureSample, x, y)
            e.set_editor_property("texture", t); e.set_editor_property("sampler_type", st); return e
        if name == "M_TC_HandVeins":
            n = samp(veins_n, unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL, -500, 0)
            k = samp(veins_m, unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_GRAYSCALE, -500, 250)
            MEL.connect_material_property(n, "RGB", unreal.MaterialProperty.MP_NORMAL)
            MEL.connect_material_property(k, "R", unreal.MaterialProperty.MP_OPACITY)
        else:
            c = samp(dirt_c, unreal.MaterialSamplerType.SAMPLERTYPE_COLOR, -500, 0)
            r = samp(dirt_r, unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_GRAYSCALE, -500, 250)
            MEL.connect_material_property(c, "RGB", unreal.MaterialProperty.MP_BASE_COLOR)
            MEL.connect_material_property(c, "A", unreal.MaterialProperty.MP_OPACITY)
            MEL.connect_material_property(r, "R", unreal.MaterialProperty.MP_ROUGHNESS)
        MEL.recompile_material(m)
        EAL.save_loaded_asset(m)
        out[name] = m
    return out


def import_prop(name):
    """Our Blender-authored props (ue5/tools/blender/props.py -> ue5/assets/props/*.obj)."""
    src = os.path.join(PROPS, f"{name}.obj")
    dest = f"{ROOT}/Models/{name}"
    if EAL.does_directory_exist(dest):
        EAL.delete_directory(dest)
    objs = import_file(src, dest)
    meshes = [o for o in objs if isinstance(o, unreal.StaticMesh)] or \
        [unreal.load_asset(p) for p in EAL.list_assets(dest, recursive=True) if isinstance(unreal.load_asset(p), unreal.StaticMesh)]
    for sm in meshes:
        b = sm.get_bounding_box()
        log("prop", name, sm.get_name(), "bounds", round(b.min.x, 1), round(b.min.y, 1), round(b.min.z, 1), "..",
            round(b.max.x, 1), round(b.max.y, 1), round(b.max.z, 1))
    return meshes


FLAT_DETAIL = {"DetailTiling": 4.0, "DetailNormalStrength": 0.6, "DetailRough": 0.25, "DetailDarken": 0.12}


def make_mi(master, name, textures, tiling=1.0, rough=1.0, metal=0.0, tint=None, scalars=None, grime_color=None):
    path = f"{ROOT}/Materials/{name}"
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    mi = AT.create_asset(name, f"{ROOT}/Materials", unreal.MaterialInstanceConstant,
                         unreal.MaterialInstanceConstantFactoryNew())
    MEL.set_material_instance_parent(mi, master)
    for p, t in textures.items():
        if t:
            MEL.set_material_instance_texture_parameter_value(mi, p, t)
    MEL.set_material_instance_scalar_parameter_value(mi, "Tiling", tiling)
    MEL.set_material_instance_scalar_parameter_value(mi, "RoughnessScale", rough)
    MEL.set_material_instance_scalar_parameter_value(mi, "MetallicScale", metal)
    if tint:
        MEL.set_material_instance_vector_parameter_value(mi, "Tint", unreal.LinearColor(*tint, 1.0))
    if grime_color:
        MEL.set_material_instance_vector_parameter_value(mi, "GrimeColor", unreal.LinearColor(*grime_color, 1.0))
    # untextured instances (one flat tint, flat normal, one roughness: the "plastic/CG" look, materials audit finding
    # 2) get the handling-detail layer unless they set their own Detail* values (pass C3)
    if not textures.get("BaseColor") and not textures.get("Normal"):
        for k, v in FLAT_DETAIL.items():
            MEL.set_material_instance_scalar_parameter_value(mi, k, v)
    for k, v in (scalars or {}).items():
        MEL.set_material_instance_scalar_parameter_value(mi, k, v)
    MEL.update_material_instance(mi)
    EAL.save_loaded_asset(mi)
    return mi


def surface_material(master, tex_name, name=None, **kw):
    d = os.path.join(ASSETS, "textures", tex_name)
    dest = f"{ROOT}/Textures/{tex_name}"
    maps = {}
    for f in sorted(os.listdir(d)):
        stem = os.path.splitext(f)[0]
        if stem.endswith("_diff"):
            maps["BaseColor"] = import_texture(os.path.join(d, f), dest, "T_" + stem, "color")
        elif stem.endswith("_nor_dx"):
            maps["Normal"] = import_texture(os.path.join(d, f), dest, "T_" + stem, "normal")
        elif stem.endswith("_arm"):
            maps["ARM"] = import_texture(os.path.join(d, f), dest, "T_" + stem, "linear")
    return make_mi(master, name or "MI_" + tex_name, maps, **kw)


def _value_noise(size, freq, seed, sx=1, sy=1):
    """Tileable value noise in [0,1]: a wrapped (freq*sx) x (freq*sy) lattice, smoothstep-interpolated."""
    import random
    rnd = random.Random(seed)
    gx, gy = freq * sx, freq * sy
    lat = [[rnd.random() for _ in range(gx)] for _ in range(gy)]
    out = [0.0] * (size * size)
    for y in range(size):
        fy = y * gy / size
        y0 = int(fy); ty = fy - y0; ty = ty * ty * (3 - 2 * ty)
        r0, r1 = lat[y0 % gy], lat[(y0 + 1) % gy]
        row = y * size
        for x in range(size):
            fx = x * gx / size
            x0 = int(fx); tx = fx - x0; tx = tx * tx * (3 - 2 * tx)
            a = r0[x0 % gx] + (r0[(x0 + 1) % gx] - r0[x0 % gx]) * tx
            b = r1[x0 % gx] + (r1[(x0 + 1) % gx] - r1[x0 % gx]) * tx
            out[row + x] = a + (b - a) * ty
    return out


def _fbm(size, base, octaves, seed, sx=1, sy=1):
    acc = [0.0] * (size * size)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        n = _value_noise(size, base << o, seed + o * 101, sx, sy)
        for i, v in enumerate(n):
            acc[i] += v * amp
        total += amp
        amp *= 0.5
    lo, hi = min(acc), max(acc)
    return [(v - lo) / (hi - lo) for v in acc]


def grime_png(path, size=512):
    """Our own tileable grime mask: R macro blotches, G vertical-ish streaks/scratches, B micro smudges."""
    r = _fbm(size, 3, 5, 11)
    g = _fbm(size, 2, 5, 23, sx=6, sy=1)
    g = [abs(v - 0.5) * 2 for v in g]  # ridged: thin streak lines
    g = [1.0 - v for v in g]
    b = _fbm(size, 24, 3, 37)
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            i = y * size + x
            raw += bytes((int(r[i] * 255), int(g[i] ** 4 * 255), int(b[i] * 255), 255))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b""))


def model_material(master, model, prefix, name, arm=None, **kw):
    """Material instance from a Poly Haven model's own maps (diff, nor_gl, rough, optional metal) on the layered
    master, so the hero meshes get correct scanned colour plus our wear layers instead of the FBX importer's guess."""
    d = os.path.join(ASSETS, "models", model, "textures")
    dest = f"{ROOT}/Textures/{model}"
    maps = {}
    normals = {}
    for f in sorted(os.listdir(d)):
        stem, ext = os.path.splitext(f)
        if not stem.startswith(prefix):
            continue
        if "_diff_" in stem:
            maps["BaseColor"] = import_texture(os.path.join(d, f), dest, "T_" + stem, "color")
        elif "_nor_gl_" in stem:
            t = import_texture(os.path.join(d, f), dest, "T_" + stem, "normal")
            t.set_editor_property("flip_green_channel", True)  # OpenGL -> DirectX
            maps["Normal"] = t
            normals[stem.rsplit("_", 1)[-1]] = t
        elif "_rough_" in stem:
            t = import_texture(os.path.join(d, f), dest, "T_" + stem, "gray")
            # C6 specular AA in the mips (Toksvig): the roughness mips widen where the normal map's mips average
            # diverging normals, so distant scan relief turns matte instead of sparkling (rook crowns at the game FOV)
            nrm = normals.get(stem.rsplit("_", 1)[-1])
            if nrm:
                try:
                    t.set_editor_property("composite_texture", nrm)
                    t.set_editor_property("composite_texture_mode", unreal.CompositeTextureMode.CTM_NORMAL_ROUGHNESS_TO_RED)
                    t.set_editor_property("composite_power", 1.0)
                    EAL.save_loaded_asset(t)
                except Exception as e:
                    log("WARNING composite roughness", stem, e)
            maps["RoughTex"] = t
        elif "_metal_" in stem:
            maps["MetalTex"] = import_texture(os.path.join(d, f), dest, "T_" + stem, "gray")
    if arm and os.path.exists(arm):  # our baked AO (ue5/tools/textures/piece_ao.py): R = AO for the cavity term
        maps["ARM"] = import_texture(arm, f"{ROOT}/Textures/Pieces", os.path.splitext(os.path.basename(arm))[0], "linear")
    sc = dict(kw.pop("scalars", {}) or {})
    if "RoughTex" in maps:
        sc["UseRoughTex"] = 1.0
    if "MetalTex" in maps:
        sc["UseMetalTex"] = 1.0
        kw.setdefault("metal", 1.0)
    log("model material", name, sorted(maps))
    return make_mi(master, name, maps, scalars=sc, **kw)


def assign(meshes, mi, match=None):
    for sm in meshes:
        if match and not match(sm.get_name().lower()):
            continue
        for i in range(len(sm.static_materials)):
            sm.set_material(i, mi)
        EAL.save_loaded_asset(sm)


# ---------------------------------------------------------------- models

def import_model(name):
    d = os.path.join(ASSETS, "models", name)
    fbx = next(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".fbx"))
    dest = f"{ROOT}/Models/{name}"
    if EAL.does_directory_exist(dest):
        EAL.delete_directory(dest)
    objs = import_file(fbx, dest)
    meshes = [o for o in objs if isinstance(o, unreal.StaticMesh)]
    if not meshes:
        meshes = [unreal.load_asset(p) for p in EAL.list_assets(dest, recursive=True)
                  if isinstance(unreal.load_asset(p), unreal.StaticMesh)]
    # Poly Haven ships OpenGL normal maps; UE expects DirectX (green flipped).
    for p in EAL.list_assets(dest, recursive=True):
        a = unreal.load_asset(p)
        if isinstance(a, unreal.Texture2D) and "nor_gl" in a.get_name():
            a.set_editor_property("flip_green_channel", True)
            setup_texture(a, "normal")
            EAL.save_loaded_asset(a)
    # Curve objects in some FBX files (e.g. the lamp's wires) import as meshes with no polygons; they fail the cook
    # ("Bad MeshDescription"), so they are deleted instead of placed.
    kept = []
    for sm in meshes:
        try:
            empty = sm.get_num_triangles(0) == 0
        except Exception:
            empty = False
        if empty:
            log("dropping empty mesh", sm.get_path_name())
            EAL.delete_asset(sm.get_path_name())
        else:
            kept.append(sm)
    meshes = kept
    for sm in meshes:
        ns = sm.get_editor_property("nanite_settings")
        ns.enabled = True
        sm.set_editor_property("nanite_settings", ns)
        EAL.save_loaded_asset(sm)
    log("imported", name, len(meshes), "meshes")
    return meshes


def bounds_of(meshes):
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for sm in meshes:
        b = sm.get_bounding_box()
        for i, (a, c) in enumerate(((b.min.x, b.max.x), (b.min.y, b.max.y), (b.min.z, b.max.z))):
            lo[i] = min(lo[i], a)
            hi[i] = max(hi[i], c)
    return lo, hi


def place_model(meshes, loc, yaw=0.0, scale=1.0, label=None, sit_on=None):
    """Spawns every mesh of a model with one shared transform (Poly Haven meshes are baked in model space).
    sit_on: z height; the model's lowest point is placed there and loc.z is ignored."""
    lo, hi = bounds_of(meshes)
    z = loc[2] if sit_on is None else sit_on - lo[2] * scale
    actors = []
    for sm in meshes:
        a = EAS.spawn_actor_from_object(sm, unreal.Vector(loc[0], loc[1], z), unreal.Rotator(0, 0, yaw))
        a.set_actor_scale3d(unreal.Vector(scale, scale, scale))
        if label:
            a.set_folder_path(label)
            a.set_actor_label(f"{label}_{sm.get_name()}")
        actors.append(a)
    return actors, lo, hi


def box(name, loc, size, mi, folder="Room"):
    cube = unreal.load_asset("/Engine/BasicShapes/Cube")
    a = EAS.spawn_actor_from_object(cube, unreal.Vector(*loc), unreal.Rotator(0, 0, 0))
    a.set_actor_scale3d(unreal.Vector(size[0] / 100, size[1] / 100, size[2] / 100))
    a.static_mesh_component.set_material(0, mi)
    a.set_actor_label(name)
    a.set_folder_path(folder)
    return a



# ---------------------------------------------------------------- seated pose (no seated clip ships with the templates)

def _qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def _qinv(q):
    return (-q[0], -q[1], -q[2], q[3])


def _qrot(q, v):
    x, y, z, w = _qmul(_qmul(q, (v[0], v[1], v[2], 0.0)), _qinv(q))
    return (x, y, z)


def _axis(ax, deg):
    h = math.radians(deg) / 2
    s = math.sin(h)
    return (ax[0] * s, ax[1] * s, ax[2] * s, math.cos(h))


def _xf(t):
    r = t.rotation
    return ((t.translation.x, t.translation.y, t.translation.z), (r.x, r.y, r.z, r.w))


SEATED = {}


def bone_relative(bone, offset):
    """head_relative for any recorded bone (spine_03, spine_05, pelvis): props authored in component space."""
    t1, q1, q0 = SEATED[bone]
    tilt = _qmul(q1, _qinv(q0))
    o = _qrot(tilt, offset)
    iq = _qinv(q1)
    return unreal.Vector(*_qrot(iq, o)), unreal.Quat(*_qmul(iq, tilt)).rotator()


def _quat_from_axes(xa, za):
    """Quaternion (x, y, z, w) of the rotation whose X axis is xa and whose Z axis is za made orthogonal to it."""
    def norm(v):
        n = math.sqrt(sum(c * c for c in v)) or 1.0
        return tuple(c / n for c in v)
    X = norm(xa)
    d = sum(za[i] * X[i] for i in range(3))
    Z = norm(tuple(za[i] - d * X[i] for i in range(3)))
    Y = (Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0])
    m00, m01, m02 = X[0], Y[0], Z[0]
    m10, m11, m12 = X[1], Y[1], Z[1]
    m20, m21, m22 = X[2], Y[2], Z[2]
    tr = m00 + m11 + m22
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        return ((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s)
    if m00 > m11 and m00 > m22:
        s = math.sqrt(1.0 + m00 - m11 - m22) * 2
        return (0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
    if m11 > m22:
        s = math.sqrt(1.0 + m11 - m00 - m22) * 2
        return ((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
    s = math.sqrt(1.0 + m22 - m00 - m11) * 2
    return ((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)


def aimed_on_bone(key, origin, direction, up=(0.0, 0.0, 1.0)):
    """Relative transform on a recorded bone (SEATED[key] = (t, q), component space) that puts a prop authored along +X
    (its +Z up) at `origin`, pointing along `direction`, with its +Z towards `up`."""
    tb, qb = SEATED[key]
    iq = _qinv(qb)
    rel_t = _qrot(iq, (origin[0] - tb[0], origin[1] - tb[1], origin[2] - tb[2]))
    rel_q = _qmul(iq, _quat_from_axes(direction, up))
    return unreal.Vector(*rel_t), unreal.Quat(*rel_q).rotator()


def head_relative(offset):
    """Relative transform (location, rotator) on the 'head' bone that puts a prop authored face +Y / up +Z (mannequin
    component space) at `offset` from the head bone, following the seated pose's head tilt."""
    t1, q1, q0 = SEATED["head"]
    tilt = _qmul(q1, _qinv(q0))
    o = _qrot(tilt, offset)
    want_t = (t1[0] + o[0], t1[1] + o[1], t1[2] + o[2])
    iq = _qinv(q1)
    rel_t = _qrot(iq, (want_t[0] - t1[0], want_t[1] - t1[1], want_t[2] - t1[2]))
    rel_q = _qmul(iq, tilt)
    return unreal.Vector(*rel_t), unreal.Quat(*rel_q).rotator()


POSES = {
    # component-space rotations (degrees about X, the body's left-right axis; Z = turn inwards), top-down
    "rest": {"spine_01": (-6, 0), "spine_03": (-8, 0), "neck_01": (4, 0), "head": (14, 0),
             "upperarm_l": (52, 0), "upperarm_r": (52, 0), "lowerarm_l": (50, 0), "lowerarm_r": (50, 0)},
    # the reference's opponent: leaning in on the table, forearms up, hands clasped in front of the face
    # the player's own body (first person, head hidden): leaning in, hands resting on the board's near corners
    # C5: spine_01 also turns the chest square to the table (Z, negative = the right shoulder forward): the idle's twist
    # left the right shoulder 10 cm further back than the left and the right wrist out of reach (9 cm off its target)
    "player": {"spine_01": (8, float(os.environ.get("TC_PLAYER_TWIST", -10))), "spine_03": (float(os.environ.get("TC_PLAYER_LEAN", 16)), 0),  # 12 -> 16 (pass 63): reach further "neck_01": (6, 0), "head": (10, 0),
               "hand_l": (0, 0, float(os.environ.get("TC_HAND_ROLL", -95))), "hand_r": (0, 0, -float(os.environ.get("TC_HAND_ROLL", -95)))},
    "clasp": {"spine_01": (-4, 0), "spine_03": (-7, 0), "neck_01": (2, 0), "head": (4, 0),  # slight lean in, head level
              "upperarm_l": (58, -26), "upperarm_r": (58, 26), "lowerarm_l": (98, -44), "lowerarm_r": (98, 44),
              "hand_l": (0, -15), "hand_r": (0, 15)},
}


def _vsub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _vadd(a, b, s=1.0):
    return (a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s)


def _vnorm(v):
    n = math.sqrt(sum(c * c for c in v)) or 1.0
    return (v[0] / n, v[1] / n, v[2] / n)


def _vcross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _vlen(v):
    return math.sqrt(sum(c * c for c in v))


# ---- The player's resting hands (hands/character specialist, pass C1).
# Seat camera standard (docs/VISUAL_ART_DIRECTION.md section 6) at the game's DEFAULT view height. The C++
# ATCPlayerController::ApplyView moves the level camera by the view-height slider V (default 0.6, TCGame.h): +28 cm * V
# up, +5 cm * V forward, pitch -10 deg * V, focal * (1 - 0.2 V). The level camera is placed so that the DEFAULT view lands
# on the standard (eye x -90, z top+34, pitch -14.5, 30 mm); the player's body is anchored to that same eye.
VIEW_DEFAULT, VIEW_UP, VIEW_FWD, VIEW_PITCH, VIEW_FOCAL = 0.6, 28.0, 5.0, 10.0, 0.2
SEAT_EYE_X, SEAT_EYE_DZ, SEAT_PITCH, SEAT_FOCAL = (float(v) for v in os.environ.get("TC_SEAT_CAM", "-90,34,-14.5,30").split(","))
SEAT = {}  # filled by build(): "top" (table top z), "eye" (default-view eye, world)
# Measured (capture -TCProbe=Player, docs/graphics/iterations/phaseA-hands-character.md): the runtime body stands 18.5 cm
# higher than this solver's model (head 132.5 vs 114.0) while x/y agree within 2.6 cm; the body actor is lowered by it.
# 18.5 lowered the hands ~3.1 cm into the table (lead probe 2026-10-14: fingertip joints 77.2-78.7 vs top 79.95): 15.3
# C5: build_seated_pose now evaluates its sequence on the mesh and solves with the evaluated proportions and pelvis, so
# the model's head is the game's head and no fix is needed (0); 15.3 stays the fallback when that evaluation fails.
PLAYER_Z_FIX = float(os.environ.get("TC_PLAYER_ZFIX", 15.3))
# How far the default-view eye sits in front of the (hidden) head bone. 9 (C1) put the chest ~59 cm behind the table's
# near edge: the arms could not reach the board's corners (C5 model: right wrist 9 cm short). The head and neck are hidden
# in the game (ATCGameMode::BeginPlay), so the body may sit closer to the table than a real eye would allow; the chest
# and shoulders stay below the bottom of the default view (checked in the C5 main captures).
PLAYER_EYE_AHEAD = float(os.environ.get("TC_PLAYER_EYE_AHEAD", 3.0))
# Rest pose in table space (cm; x towards the board, |y| outwards, z over the table top). Wrists on the table in front of
# the board's near corners, fingers forward and inward by `yaw` so the curled index/middle/ring pads rest on the near
# frame beside the a1/h1 corner and the pinky on the frame or the table: no finger over a square (squares |x|,|y| <=
# 23.2, frame to 27.65, top 1.92). `roll` raises the thumb side (a relaxed hand rests a little on its outer edge).
# C1 asked for (-35, 25) with yaw 4 and knuckles 2 cm over the surface: out of the solver's reach with its short arms
# (wrist 12-21 cm off) and the fingers hyperextended to reach down; at runtime (longer arms) the fingertips landed on the
# frame's outer edge and dipped into it. C5 (calibrated model): wrists symmetric at the corners, fingers turned in.
PLAYER_REST = dict(zip(("wrist_x", "wrist_y", "wrist_z", "yaw", "mcp_z", "elbow_z", "elbow_y", "roll"),
                       (-42.0, 27.0, 3.4, 22.0, 4.4, 14.0, 22.0, 10.0)))
PLAYER_REST.update({k: float(v) for k, v in zip(("wrist_x", "wrist_y", "wrist_z", "yaw", "mcp_z", "elbow_z", "elbow_y", "roll"),
                                                 os.environ.get("TC_PLAYER_REST", "").split(",")) if v.strip()})
PLAYER_SPREAD = float(os.environ.get("TC_PLAYER_SPREAD", 0.35))  # share of each finger's splay closed towards the middle finger
BOARD_HALF, BOARD_PLAY_HALF, BOARD_FRAME_Z, BOARD_SURF_Z = 27.65, 23.2, 1.92, 1.71  # props.py chess_board()


def board_surface(x, y):
    """Height over the table top of what lies under world (x, y), and its name: frame, squares or table."""
    if abs(x) <= BOARD_HALF and abs(y) <= BOARD_HALF:
        if abs(x) < BOARD_PLAY_HALF and abs(y) < BOARD_PLAY_HALF:
            return BOARD_SURF_Z, "squares"
        return BOARD_FRAME_Z, "frame"
    return 0.0, "table"


def _surface_under(w, r=0.0):
    """board_surface() of the highest surface within r cm (horizontally) of world point w: a finger near the frame's
    outer edge must clear the frame, not the table beside it (C1: index/middle dipped up to 2 cm into the frame)."""
    best = board_surface(w[0], w[1])
    if r > 0:
        d = 0.7 * r
        for dx, dy in ((r, 0), (-r, 0), (0, r), (0, -r), (d, d), (-d, d), (d, -d), (-d, -d)):
            s = board_surface(w[0] + dx, w[1] + dy)
            if s[0] > best[0]:
                best = s
    return best


# Relaxed resting hand (reference main view: fingers gently curled, pads on the frame, nails facing the seat). Preferred
# ABSOLUTE flexion in degrees at the knuckle (MCP: proximal phalanx against the hand's wrist-knuckle line) and at the
# middle joint (PIP: middle against proximal phalanx), rising from index to pinky; the end joint follows at DIP_RATIO x
# the added PIP flexion (the coupled tendon of a relaxed finger). C5: the C1 solver searched -30..60 relative to the
# reference pose and every finger ended at -30 (hyperextended, the judge's "stretched fingers"). The MetaHuman reference
# pose already flexes the fingers (~22 deg MCP, ~12 deg PIP), so the curl is now judged in absolute angles.
FINGER_CURL = {"thumb": (0, 8), "index": (12, 38), "middle": (14, 42), "ring": (16, 44), "pinky": (18, 46)}
DIP_RATIO = 0.7
FINGER_R, TIP_R = 0.8, 0.65  # centre line to skin: finger body / pad (cm)
FINGER_PREF = float(os.environ.get("TC_FINGER_PREF", 0.004))  # weight of the relaxed curl against the contact (per deg^2)


def _signed_angle(u, v, axis):
    """Angle in degrees from u to v about axis (right hand)."""
    return math.degrees(math.atan2(sum(a * b for a, b in zip(_vcross(u, v), axis)), sum(a * b for a, b in zip(u, v))))


def _finger_rest(p1, p2, p3, N, to_world, top, finger, F=None, q3=None):
    """Curl one finger (joints p1..p3 = _01.._03, component space) about its own hinge axis: the pad of the distal
    segment rests on the surface under it (centre line TIP_R over the highest surface within 0.7 cm), every other
    sampled point of the centre line stays FINGER_R over the highest surface within 0.9 cm (no joint or segment inside
    the frame's edge), nothing over the playing squares, and the absolute flexion stays near FINGER_CURL (measured
    against the hand line F; the thumb's preference is relative). The distal segment runs along the _03 bone's own axis
    (q3), as _finger_tip() and the probe log assume. Returns (axis, mcp, pip, dip): component-space rotations in degrees
    added at _01, _02 and _03."""
    L = _vnorm(_vcross(_vnorm(_vsub(p3, p1)), N))
    seg1, seg2 = _vsub(p2, p1), _vsub(p3, p2)
    l3 = 0.8 * _vlen(seg2)
    d30 = _vnorm(seg2)
    if q3 is not None:
        ax = _qrot(q3, (1.0, 0.0, 0.0))
        d30 = ax if sum(x * y for x, y in zip(ax, seg2)) > 0 else (-ax[0], -ax[1], -ax[2])
    want_a, want_b = FINGER_CURL[finger]
    if F is not None and finger != "thumb":  # the reference pose's own flexion, so the preference is absolute
        Fp = _vnorm(_vsub(F, tuple(c * sum(a * b for a, b in zip(F, L)) for c in L)))
        want_a -= _signed_angle(Fp, _vnorm(seg1), L)
        want_b -= _signed_angle(_vnorm(seg1), _vnorm(seg2), L)
    def clear(c, r):
        w = to_world(c)
        return w[2] - top - _surface_under(w, r)[0]
    best = None
    for a in range(-36, 41, 2):
        j2 = _vadd(p1, _qrot(_axis(L, a), seg1))
        for b in range(-12, 70, 3):
            c = round(DIP_RATIO * max(b, 0))
            j3 = _vadd(j2, _qrot(_axis(L, a + b), seg2))
            d3 = _qrot(_axis(L, a + b + c), d30)
            body = [_vadd(p1, _vsub(j2, p1), 0.5), j2, _vadd(j2, _vsub(j3, j2), 0.5), j3]
            dist = [_vadd(j3, d3, l3 * t) for t in (0.4, 0.75, 1.0)]
            cmin = min(clear(p, 0.9) for p in body)
            dmin = min(clear(p, 0.7) for p in dist)
            cost = 4.0 * (dmin - TIP_R) ** 2 + FINGER_PREF * ((a - want_a) ** 2 + (b - want_b) ** 2)
            if cmin < FINGER_R:
                cost += 20.0 * (FINGER_R - cmin) ** 2 + 2.0
            if dmin < TIP_R - 0.15:
                cost += 40.0 * (TIP_R - 0.15 - dmin) ** 2 + 4.0
            if any(board_surface(*to_world(p)[:2])[1] == "squares" for p in (j3, dist[1], dist[-1])):
                cost += 50.0  # never rest a finger on the playing squares (the pieces stand there)
            if best is None or cost < best[0]:
                best = (cost, a, b, c)
    return L, best[1], best[2], best[3]


def _steeple_finger(p1, p2, p3, Np, mid_x, side_sign, finger):
    """The patient's steepled hands: curl one finger about its hinge (positive = towards the palm, which faces the other
    hand) so that its pad meets the mirrored finger at the midplane x = mid_x, while every other part of the finger
    stays on its own side (no finger through the other hand). side_sign: +1 if this hand lies at x > mid_x."""
    L = _vnorm(_vcross(_vnorm(_vsub(p3, p1)), Np))
    seg1, seg2 = _vsub(p2, p1), _vsub(p3, p2)
    l3 = 0.8 * _vlen(seg2)
    want_a, want_b = (6, 10) if finger != "thumb" else (0, 6)
    def gap(c):  # centre line distance from the midplane, on this hand's side
        return side_sign * (c[0] - mid_x)
    best = None
    for a in range(-24, 41, 2):
        j2 = _vadd(p1, _qrot(_axis(L, a), seg1))
        for b in range(-6, 46, 3):
            c = round(DIP_RATIO * b)
            j3 = _vadd(j2, _qrot(_axis(L, a + b), seg2))
            d3 = _vnorm(_qrot(_axis(L, a + b + c), seg2))
            tip = _vadd(j3, d3, l3)
            body = [j2, _vadd(j2, _vsub(j3, j2), 0.5), j3, _vadd(j3, d3, 0.5 * l3)]
            cost = 4.0 * (gap(tip) - TIP_R) ** 2 + 0.002 * ((a - want_a) ** 2 + (b - want_b) ** 2)
            bmin = min(gap(p) for p in body)
            if bmin < FINGER_R:
                cost += 20.0 * (FINGER_R - bmin) ** 2 + 2.0
            if best is None or cost < best[0]:
                best = (cost, a, b, c)
    return L, best[1], best[2], best[3]


def _finger_tip(new_w, b2, b3):
    """Estimated fingertip (component space): the distal segment continues the _03 bone's axis by 0.8 x the middle
    segment's length (the probe logs only the _03 joint)."""
    j2, (j3, q3) = new_w[b2][0], new_w[b3]
    ax = _qrot(q3, (1.0, 0.0, 0.0))
    seg = _vsub(j3, j2)
    if sum(a * b for a, b in zip(ax, seg)) < 0:  # the bone's +X points back up the finger on this side
        ax = (-ax[0], -ax[1], -ax[2])
    return _vadd(j3, ax, 0.8 * _vlen(seg))


def _nlerp(a, b, t):
    """Normalised lerp between two quaternions (x, y, z, w), taking the short way round."""
    if sum(a[i] * b[i] for i in range(4)) < 0:
        b = tuple(-v for v in b)
    q = [a[i] * (1 - t) + b[i] * t for i in range(4)]
    n = math.sqrt(sum(v * v for v in q)) or 1.0
    return tuple(v / n for v in q)


def _angle_deg(qa, qb):
    d = abs(sum(qa[i] * qb[i] for i in range(4)))
    return math.degrees(2 * math.acos(min(1.0, d)))


# The patient's breathing idle (C5): a looping sequence instead of one keyed frame. Chest and upper back rise and fall
# (spine_03/spine_05 about the body's left-right axis), the head keeps its gaze (counter-rotation) and drifts slowly. The
# arms are children of the chest, so the steepled hands move with it rigidly (< 0.5 cm) and never part. Only the
# opponents breathe: the player's resting hands must not slide on the table under the fixed seat camera.
IDLE_POSES = ("clasp",)
IDLE_SECONDS, IDLE_FPS = float(os.environ.get("TC_IDLE_SECONDS", 5.0)), 30
IDLE_AMP = float(os.environ.get("TC_IDLE_AMP", 1.0))  # 0 = the old statue


def _idle_deltas(deltas, f, frames, order, parent):
    """Breathing offsets for frame f of a loop of `frames` frames (frame 0 = the rest pose exactly). Each breathing bone
    turns its whole subtree rigidly: a solved delta below it is conjugated by the accumulated turn (a plain pre-rotation
    would re-aim the arms in component space and the steepled fingertips would press 0.4 cm into each other)."""
    if frames <= 1 or IDLE_AMP <= 0:
        return deltas
    ph = 2 * math.pi * f / frames
    breath = math.sin(ph) * IDLE_AMP  # +1 = full inhale
    X, Z = (1.0, 0.0, 0.0), (0.0, 0.0, 1.0)
    turn = IDLE_AMP * (0.9 * math.sin(ph + 1.3) + 0.4 * math.sin(2 * ph + 0.4))
    nod = IDLE_AMP * 0.5 * math.sin(ph + 2.1)
    own = {"spine_03": _axis(X, -0.7 * breath),  # negative X: the chest lifts and opens (positive leans the body in)
           "spine_05": _axis(X, -0.5 * breath),
           "head": _qmul(_axis(Z, turn), _axis(X, 1.2 * breath + nod))}  # the gaze stays on the board while the chest moves
    ident = (0.0, 0.0, 0.0, 1.0)
    out, acc = dict(deltas), {}
    for b in order:
        cp = acc.get(parent.get(b), ident)
        if b in out and cp != ident:
            out[b] = _qmul(_qmul(cp, out[b]), _qinv(cp))
        if b in own:
            out[b] = _qmul(own[b], out.get(b, ident))
            acc[b] = _qmul(own[b], cp)
        elif cp != ident:
            acc[b] = cp
    return out


def _pose_inputs(skel_mesh, base_anim, own_proportions, pose_name):
    """Bone names, parents, local and component transforms of the base animation's first frame (MM_Idle), with the
    target mesh's bone lengths when own_proportions."""
    opts = unreal.AnimPoseEvaluationOptions()
    pose = unreal.AnimPoseExtensions.get_anim_pose_at_time(base_anim, 0.0, opts)
    names = [str(n) for n in unreal.AnimPoseExtensions.get_bone_names(pose)]
    loc = {n: _xf(unreal.AnimPoseExtensions.get_bone_pose(pose, n, unreal.AnimPoseSpaces.LOCAL)) for n in names}
    wld = {n: _xf(unreal.AnimPoseExtensions.get_bone_pose(pose, n, unreal.AnimPoseSpaces.WORLD)) for n in names}

    # The reference skeleton lists parents before children, so only earlier bones are candidates (no cycles even when
    # helper bones share a transform with a real joint). Prefer the nearest earlier match on ties.
    parent = {}
    for i, b in enumerate(names):
        best, err = None, 1e9
        for p in reversed(names[:i]):
            tp, qp = wld[p]
            t = _qrot(qp, loc[b][0])
            e = sum((tp[i] + t[i] - wld[b][0][i]) ** 2 for i in range(3))
            q = _qmul(qp, loc[b][1])
            e += 100 * min(sum((q[i] - wld[b][1][i]) ** 2 for i in range(4)),
                           sum((q[i] + wld[b][1][i]) ** 2 for i in range(4)))
            if e < err - 1e-6:
                best, err = p, e
        parent[b] = best if err < 1.0 else None

    if own_proportions:
        # Poses come from the mannequin's idle (same joint orientations as the MetaHuman body skeleton); bone lengths
        # come from the skeleton's reference pose here, and from the mesh as evaluated (build_seated_pose's loop) after.
        ref = unreal.AnimPoseExtensions.get_reference_pose(skel_mesh.get_editor_property("skeleton"))
        ref_names = {str(n) for n in unreal.AnimPoseExtensions.get_bone_names(ref)}
        for b in names:
            if b in ref_names:
                loc[b] = (_xf(unreal.AnimPoseExtensions.get_bone_pose(ref, b, unreal.AnimPoseSpaces.LOCAL))[0], loc[b][1])
        names = [b for b in names if b in ref_names]
        if pose_name in ("player", "clasp"):
            # The idle's hanging hands curl every finger. Start the fingers from the reference pose (straight) and author
            # the curl explicitly (_finger_rest / _steeple_finger). C1 kept 20% of the idle's curl (TC_FINGER_RELAX 0.8).
            relax = float(os.environ.get("TC_FINGER_RELAX", 1.0))
            for b in names:
                if b.startswith(("thumb_", "index_", "middle_", "ring_", "pinky_")) and not b.endswith(("metacarpal_l", "metacarpal_r")):
                    rq = _xf(unreal.AnimPoseExtensions.get_bone_pose(ref, b, unreal.AnimPoseSpaces.LOCAL))[1]
                    loc[b] = (loc[b][0], _nlerp(loc[b][1], rq, relax))

    order = []
    seen = set()
    def visit(b):
        if b in seen:
            return
        if parent[b]:
            visit(parent[b])
        seen.add(b)
        order.append(b)
    for b in names:
        visit(b)
    # key_t: the translations written into the sequence (the skeleton's reference). The game scales each keyed
    # translation to the mesh's proportions (C5 dump: evaluated = keyed x 1.03-1.32 per bone, same direction), so the
    # keys must stay at the reference while the model (loc) takes the evaluated lengths.
    return {"names": names, "parent": parent, "loc": loc, "wld": wld, "order": order, "pelvis_bias": (0.0, 0.0, 0.0),
            "key_t": {b: loc[b][0] for b in names}}


ARM_TARGETS = {
    # C5: the reference's patient holds his clasped hands up in front of his face. Wrists 19 cm under and 20 cm in front of
    # the head bone (the cage mask reaches ~16.5 cm in front of it at mouth height), elbows low (forearms steep), hands
    # steepled at the midline (fingertips meeting, no finger through the other hand). Was (3, 18, -21) / -31 / 19:
    # forearms as a flat bar at chest height, one hand laid over the other forearm (judge V5 #5: finger overlap).
    "clasp": {"hand": tuple(float(v) for v in os.environ.get("TC_CLASP_HAND", "5,20,-19").split(",")),
              "elbow_z": float(os.environ.get("TC_CLASP_ELBOW_Z", -32)), "elbow_x": 15.0},
    # pass 60: (22, 46, -32) left the left wrist below the frame and the right hand a sliver at the corner
    "player": {"hand": tuple(float(v) for v in os.environ.get("TC_PLAYER_HAND", "19,58,-32").split(",")),
               "elbow_z": -36.0, "elbow_x": 22.0}}  # pass 63: elbows may lift off the table (out of view) for reach
CLASP_HANDS = {k: float(v) for k, v in zip(("tent", "fwd"), os.environ.get("TC_CLASP_STEEPLE", "8,18").split(","))}
CAGE_ELLIPSOID = ((0.0, 5.85, -0.3), (10.6, 11.0, 13.9))  # cage_mask bounds (+-10.3, -9.3..12, -12.9..14.3) on TC_MASK_OFFSET 0,4.5,-1


def solve_seated_pose(D, pose_name):
    """Pure solver (no unreal calls; ue5/tools reproduces it offline from a TC_POSE_DUMP): component-space pose of every
    bone. Returns new_w, new_l (bone -> (t, q)), the final deltas and the solve() closure (breathing frames)."""
    names, parent, loc, order = D["names"], D["parent"], D["loc"], D["order"]
    X, Z = (1.0, 0.0, 0.0), (0.0, 0.0, 1.0)
    deltas = {"thigh_l": _axis(X, 90), "thigh_r": _axis(X, 90), "calf_l": _axis(X, -90), "calf_r": _axis(X, -90)}
    Y = (0.0, 1.0, 0.0)
    for bone, rot in POSES[pose_name].items():  # component-space rotation applied to each bone's orientation, top-down
        ax, az, ay = (tuple(rot) + (0.0,))[:3]
        deltas[bone] = _qmul(_axis(Y, ay), _qmul(_axis(Z, az), _axis(X, ax)))  # ay: roll about the forward axis
    pelvis_drop = float(os.environ.get("TC_PELVIS_DROP", 47.0)) + (6.0 if pose_name == "clasp" else 0.0)  # he sits low, bowed in
    bias = D.get("pelvis_bias", (0.0, 0.0, 0.0))

    def solve(deltas):
        new_w, new_l = {}, dict(loc)
        for b in order:
            p = parent[b]
            t_l, q_l = new_l[b]
            if p is None:
                t_w, q_w = t_l, q_l
            else:
                tp, qp = new_w[p]
                r = _qrot(qp, t_l)
                t_w, q_w = (tp[0] + r[0], tp[1] + r[1], tp[2] + r[2]), _qmul(qp, q_l)
            if b == "pelvis":
                # the keyed pelvis is dropped by pelvis_drop; the model adds the measured difference between the keyed
                # and the evaluated pelvis (the skeleton's translation retargeting does not honour the whole drop)
                t_w = (t_w[0] + bias[0], t_w[1] + bias[1], t_w[2] - pelvis_drop + bias[2])
            if b in deltas:
                q_w = _qmul(deltas[b], q_w)
            if (b in deltas or b == "pelvis") and p is not None:
                tp, qp = new_w[p]
                iq = _qinv(qp)
                tk = (t_w[0] - bias[0], t_w[1] - bias[1], t_w[2] - bias[2]) if b == "pelvis" else t_w
                d = (tk[0] - tp[0], tk[1] - tp[1], tk[2] - tp[2])
                new_l[b] = (_qrot(iq, d), _qmul(iq, q_w))
            new_w[b] = (t_w, q_w)
        return new_w, new_l

    new_w, new_l = solve(deltas)
    if pose_name in ARM_TARGETS and all(b in new_w for b in ("upperarm_l", "lowerarm_l", "hand_l", "upperarm_r", "lowerarm_r", "hand_r")):
        # Search the arm rotations instead of guessing them: elbows on the table, hands meeting in front of the chin.
        head = new_w["head"][0]
        def chain(side, ux, uz, lx, lz):
            dl = dict(deltas)
            dl[f"upperarm_{side}"] = _qmul(_axis(Z, uz), _axis(X, ux))
            dl[f"lowerarm_{side}"] = _qmul(_axis(Z, lz), _axis(X, lx))
            par = parent[f"upperarm_{side}"]
            tp, qp = new_w[par]
            out = {}
            for b in (f"upperarm_{side}", f"lowerarm_{side}", f"hand_{side}"):
                t_l, q_l = loc[b]
                r = _qrot(qp, t_l)
                t_w, q_w = (tp[0] + r[0], tp[1] + r[1], tp[2] + r[2]), _qmul(qp, q_l)
                if b in dl:
                    q_w = _qmul(dl[b], q_w)
                out[b] = (t_w, q_w)
                tp, qp = t_w, q_w
            return out
        best = {}
        player = pose_name == "player" and "eye" in SEAT
        if player:
            # Table-space targets (pass C1): the body actor is placed from the default-view eye (build(): ploc), so the
            # model maps component c -> world (P.x + c.y, P.y - c.x, P.z + c.z) with P below (yaw -90).
            top = SEAT["top"]
            ex, _, ez = SEAT["eye"]
            P = (ex - (head[1] + PLAYER_EYE_AHEAD), head[0], ez - (head[2] + 8.0))
            to_world = lambda c: (P[0] + c[1], P[1] - c[0], P[2] + c[2])
            to_comp_dir = lambda d: (-d[1], d[0], d[2])
            rest = PLAYER_REST
        for side, sx in (("l", 1.0), ("r", -1.0)):
            # which way is "this arm's side": the upper arm's x sign in the seated torso
            sign = 1.0 if new_w[f"upperarm_{side}"][0][0] > head[0] else -1.0
            tg = ARM_TARGETS[pose_name]
            target = (head[0] + sign * tg["hand"][0], head[1] + tg["hand"][1], head[2] + tg["hand"][2])
            elbow_z = head[2] + tg["elbow_z"]  # elbows on the table: the table top is ~31 cm under the seated head
            elbow_x, w_hand, w_ez, w_ex = tg["elbow_x"], 1.0, 0.5, 0.3
            if pose_name == "clasp":
                w_hand = 4.0  # the steeple needs both wrists where asked (C4 log: right hand 6 cm off, error 35)
            if player:
                # component x = P.y - world y: this side's wrist at world y = -sign * |y|
                target = (head[0] + sign * rest["wrist_y"], rest["wrist_x"] - P[0], top + rest["wrist_z"] - P[2])
                elbow_z, elbow_x = top + rest["elbow_z"] - P[2], rest["elbow_y"]
                w_hand, w_ez, w_ex = 4.0, 0.2, 0.1  # the wrist position is the contact: it dominates
            def score(ux, uz, lx, lz):
                o = chain(side, ux, uz, lx, lz)
                e, h = o[f"lowerarm_{side}"][0], o[f"hand_{side}"][0]
                err = w_hand * sum((h[i] - target[i]) ** 2 for i in range(3)) + w_ez * (e[2] - elbow_z) ** 2
                err += w_ex * (abs(e[0] - head[0]) - elbow_x) ** 2   # elbows spread, forearms in a V
                if (h[0] - head[0]) * sign < -1.0:   # hands meet, they do not cross
                    err += 300
                if e[1] < head[1] + 6:   # elbows forward of the chest, on the table
                    err += 400
                if player and e[2] < top + 4.0 - P[2]:  # the elbow never sinks into the table
                    err += 400
                return err
            score_best = None
            for ux in range(10, 131, 8):
                for uz in range(-80, 81, 10):
                    for lx in range(-30, 161, 10):  # from 20 the player's right forearm sat on the bound (IK error 324, pass 60)
                        for lz in range(-80, 81, 10):
                            err = score(ux, uz, lx, lz)
                            if score_best is None or err < score_best:
                                score_best, best[side] = err, (ux, uz, lx, lz)
            for step in (3, 1):  # refine around the coarse optimum (the 8-10 deg grid left the wrist 2-3 cm off its target)
                b0 = best[side]
                for dux in range(-3, 4):
                    for duz in range(-3, 4):
                        for dlx in range(-3, 4):
                            for dlz in range(-3, 4):
                                cand = (b0[0] + dux * step, b0[1] + duz * step, b0[2] + dlx * step, b0[3] + dlz * step)
                                err = score(*cand)
                                if err < score_best:
                                    score_best, best[side] = err, cand
            hand_at = chain(side, *best[side])[f"hand_{side}"][0]
            log(pose_name, side, "best", best[side], "error", round(score_best, 1), "target", [round(v, 1) for v in target],
                "wrist off by", round(_vlen(_vsub(hand_at, target)), 1))
        for side in ("l", "r"):
            ux, uz, lx, lz = best[side]
            deltas[f"upperarm_{side}"] = _qmul(_axis(Z, uz), _axis(X, ux))
            deltas[f"lowerarm_{side}"] = _qmul(_axis(Z, lz), _axis(X, lx))
        new_w, new_l = solve(deltas)
        if player:
            # Lay each hand on the table: fingers forward and inward by rest["yaw"], the knuckles rest["mcp_z"] over
            # whatever lies under them (wrist extension instead of the forearm's downward line), the thumb side raised
            # by rest["roll"] (a relaxed hand rests on its outer edge a little, it is not pressed flat).
            for it in range(2):
                for side in ("l", "r"):
                    sgn = 1.0 if new_w[f"upperarm_{side}"][0][0] > head[0] else -1.0  # +1: this hand at world -y
                    hb = f"hand_{side}"
                    if not all(f"{f}_{side}" in new_w for f in ("middle_01", "index_01", "pinky_01")):
                        continue
                    h = new_w[hb][0]
                    m1 = new_w[f"middle_01_{side}"][0]
                    hl = _vlen(_vsub(m1, h))
                    yaw = math.radians(rest["yaw"])
                    hw = to_world(h)
                    # medial (towards the board centre line) is world +y for the hand at -y
                    fx, fy = math.cos(yaw), sgn * math.sin(yaw)
                    mw = (hw[0] + fx * hl, hw[1] + fy * hl)
                    drop = hw[2] - (top + _surface_under(mw, 1.5)[0] + rest["mcp_z"])
                    pitch = math.asin(max(-0.7, min(0.7, drop / hl)))
                    Dw = (fx * math.cos(pitch), fy * math.cos(pitch), -math.sin(pitch))
                    Tw = (-math.sin(yaw), sgn * math.cos(yaw), 0.0)
                    Uw = _vnorm(_vcross(Tw, Dw))  # up, square to the fingers
                    Uw = Uw if Uw[2] > 0 else (-Uw[0], -Uw[1], -Uw[2])
                    roll = math.radians(rest["roll"])
                    Tw = _vadd(tuple(c * math.cos(roll) for c in Tw), Uw, math.sin(roll))
                    Dc, Tc = to_comp_dir(Dw), to_comp_dir(Tw)
                    F = _vnorm(_vsub(m1, h))
                    S = _vsub(new_w[f"index_01_{side}"][0], new_w[f"pinky_01_{side}"][0])
                    R = _qmul(_quat_from_axes(Dc, Tc), _qinv(_quat_from_axes(F, S)))
                    deltas[hb] = _qmul(R, deltas.get(hb, (0.0, 0.0, 0.0, 1.0)))
                new_w, new_l = solve(deltas)
            for side in ("l", "r"):
                hb = f"hand_{side}"
                if f"middle_01_{side}" not in new_w:
                    continue
                F = _vnorm(_vsub(new_w[f"middle_01_{side}"][0], new_w[hb][0]))
                S = _vsub(new_w[f"index_01_{side}"][0], new_w[f"pinky_01_{side}"][0])
                N = _vnorm(_vcross(F, S))
                N = N if N[2] < 0 else (-N[0], -N[1], -N[2])  # out of the palm: down
                # close the reference pose's splay: index, ring and pinky turn towards the middle finger about the palm
                # normal by PLAYER_SPREAD of their angle to it (straight splayed fingers read as a paddle, Phase A)
                if f"middle_02_{side}" not in new_w:
                    continue
                md = _vnorm(_vsub(new_w[f"middle_02_{side}"][0], new_w[f"middle_01_{side}"][0]))
                for f in ("index", "ring", "pinky"):
                    b1, b2 = f"{f}_01_{side}", f"{f}_02_{side}"
                    if b1 not in new_w or b2 not in new_w:
                        continue
                    fd = _vnorm(_vsub(new_w[b2][0], new_w[b1][0]))
                    ang = math.degrees(math.atan2(sum(a * b for a, b in zip(_vcross(fd, md), N)), sum(a * b for a, b in zip(fd, md))))
                    deltas[b1] = _qmul(_axis(N, PLAYER_SPREAD * ang), deltas.get(b1, (0.0, 0.0, 0.0, 1.0)))
            new_w, new_l = solve(deltas)
            # fingers and thumb: relaxed curl, pads on the frame/table, nothing below a surface
            for side in ("l", "r"):
                hb = f"hand_{side}"
                if f"middle_01_{side}" not in new_w:
                    continue
                F = _vnorm(_vsub(new_w[f"middle_01_{side}"][0], new_w[hb][0]))
                S = _vsub(new_w[f"index_01_{side}"][0], new_w[f"pinky_01_{side}"][0])
                N = _vnorm(_vcross(F, S))
                N = N if N[2] < 0 else (-N[0], -N[1], -N[2])  # out of the palm: down
                for f in ("thumb", "index", "middle", "ring", "pinky"):
                    bs = [f"{f}_0{k}_{side}" for k in (1, 2, 3)]
                    if not all(b in new_w for b in bs):
                        continue
                    L, a, b, c = _finger_rest(*(new_w[b][0] for b in bs), N, to_world, top, f, F, new_w[bs[2]][1])
                    for bone, ang in zip(bs, (a, b, c)):
                        deltas[bone] = _qmul(_axis(L, ang), deltas.get(bone, (0.0, 0.0, 0.0, 1.0)))
                    log("player finger", side, f, "curl", a, b, c)
            new_w, new_l = solve(deltas)
            # predicted contact in world space (compare with capture -TCProbe=Player): joints and the estimated tip
            for side in ("l", "r"):
                for b in (f"hand_{side}", f"index_03_{side}", f"middle_03_{side}", f"ring_03_{side}", f"pinky_03_{side}", f"thumb_03_{side}"):
                    if b in new_w:
                        w = to_world(new_w[b][0])
                        z0, what = board_surface(w[0], w[1])
                        msg = ["player rest", b, "world", [round(v, 1) for v in w], "over", what, "by", round(w[2] - top - z0, 1)]
                        if b.endswith(("_03_l", "_03_r")) and parent.get(b) in new_w:
                            tip = to_world(_finger_tip(new_w, parent[b], b))
                            zt, wt = board_surface(tip[0], tip[1])
                            msg += ["tip", [round(v, 1) for v in tip], "over", wt, "by", round(tip[2] - top - zt, 1)]
                        log(*msg)
        if pose_name == "clasp" and all(f"middle_01_{s}" in new_w for s in ("l", "r")):
            # Steepled hands in front of the face (reference: hands clasped before the mouth). Each hand: fingers up,
            # tilted forward by fwd (away from the cage) and towards the midline by tent; palm facing the other hand.
            mid_x = 0.5 * (new_w["hand_l"][0][0] + new_w["hand_r"][0][0])
            tent, fwd = math.radians(CLASP_HANDS["tent"]), math.radians(CLASP_HANDS["fwd"])
            for it in range(2):
                for side in ("l", "r"):
                    hb = f"hand_{side}"
                    h = new_w[hb][0]
                    ss = 1.0 if h[0] > mid_x else -1.0
                    F = _vnorm(_vsub(new_w[f"middle_01_{side}"][0], h))
                    S = _vsub(new_w[f"index_01_{side}"][0], new_w[f"pinky_01_{side}"][0])
                    N = _vnorm(_vcross(F, S))
                    # the palm side: the thumb's base lies in front of the knuckle line, on the palm side
                    pal = 1.0 if sum(a * b for a, b in zip(_vsub(new_w[f"thumb_02_{side}"][0], new_w[f"index_01_{side}"][0]), N)) > 0 else -1.0
                    Dt = _vnorm((-ss * math.sin(tent), math.sin(fwd) * math.cos(tent), math.cos(fwd) * math.cos(tent)))
                    # S target: thumbs towards the face (-y) if that turns the palm to the other hand, else away
                    Tt = (0.0, -1.0, 0.0)
                    Ncand = _vcross(Dt, Tt)
                    if pal * Ncand[0] * -ss < 0:
                        Tt = (0.0, 1.0, 0.0)
                    R = _qmul(_quat_from_axes(Dt, Tt), _qinv(_quat_from_axes(F, S)))
                    deltas[hb] = _qmul(R, deltas.get(hb, (0.0, 0.0, 0.0, 1.0)))
                    if it == 1:
                        log("clasp hand", side, "thumbs", "to the face" if Tt[1] < 0 else "away from the face")
                new_w, new_l = solve(deltas)
            for side in ("l", "r"):
                h = new_w[f"hand_{side}"][0]
                ss = 1.0 if h[0] > mid_x else -1.0
                F = _vnorm(_vsub(new_w[f"middle_01_{side}"][0], h))
                S = _vsub(new_w[f"index_01_{side}"][0], new_w[f"pinky_01_{side}"][0])
                N = _vnorm(_vcross(F, S))
                Np = N if N[0] * -ss > 0 else (-N[0], -N[1], -N[2])  # towards the other hand
                for f in ("thumb", "index", "middle", "ring", "pinky"):
                    bs = [f"{f}_0{k}_{side}" for k in (1, 2, 3)]
                    if not all(b in new_w for b in bs):
                        continue
                    L, a, b, c = _steeple_finger(*(new_w[b][0] for b in bs), Np, mid_x, ss, f)
                    for bone, ang in zip(bs, (a, b, c)):
                        deltas[bone] = _qmul(_axis(L, ang), deltas.get(bone, (0.0, 0.0, 0.0, 1.0)))
                    log("clasp finger", side, f, "curl", a, b, c)
            new_w, new_l = solve(deltas)
            # checks: every finger joint on its own side of the midline, and clear of the cage mask
            gaps = []
            for side in ("l", "r"):
                ss = 1.0 if new_w[f"hand_{side}"][0][0] > mid_x else -1.0
                gaps += [ss * (new_w[b][0][0] - mid_x) for b in new_w if b.endswith(f"_{side}") and b.startswith(
                    ("thumb_", "index_", "middle_", "ring_", "pinky_"))]
            th, qh = new_w["head"]
            (cx, cy, cz), (rx, ry, rz) = CAGE_ELLIPSOID
            def cage_clear(p):
                # head bone frame at the seated pose (the cage is attached with head_relative: it follows the head bone)
                q0 = SEATED_IDLE_HEAD.get("q0") or qh
                tilt = _qmul(qh, _qinv(q0))
                v = _qrot(_qinv(tilt), _vsub(p, th))
                d = math.sqrt(((v[0] - cx) / rx) ** 2 + ((v[1] - cy) / ry) ** 2 + ((v[2] - cz) / rz) ** 2)
                return (d - 1.0) * min(rx, ry, rz)
            cage = min(cage_clear(new_w[b][0]) for b in new_w if b.startswith(("hand_", "thumb_", "index_", "middle_", "ring_", "pinky_"))
                       and b.endswith(("_l", "_r")))
            log("clasp check: min finger-joint distance from the midline", round(min(gaps), 2), "cm; min hand clearance from the cage",
                round(cage, 1), "cm (approx.)")
        SEATED[f"{pose_name}_hands"] = {s_: (new_w[f"hand_{s_}"][0], new_w[f"lowerarm_{s_}"][0]) for s_ in ("l", "r")}
        for s_ in ("l", "r"):  # arm bone transforms, for props aimed along the arm (player hand options, sleeves)
            SEATED[f"{pose_name}:lowerarm_{s_}"] = new_w[f"lowerarm_{s_}"]
            SEATED[f"{pose_name}:upperarm_{s_}"] = new_w[f"upperarm_{s_}"]
        log(pose_name, "hands", [round(v, 1) for v in new_w["hand_l"][0]], [round(v, 1) for v in new_w["hand_r"][0]],
            "elbows", [round(v, 1) for v in new_w["lowerarm_l"][0]], [round(v, 1) for v in new_w["lowerarm_r"][0]])
    return {"new_w": new_w, "new_l": new_l, "deltas": deltas, "solve": solve, "order": order, "parent": parent}


SEATED_IDLE_HEAD = {}  # the idle's head orientation (q0) while solving; the cage check needs the same tilt as head_relative


_TRACKED = set()


def _new_sequence(skel_mesh, dest, name):
    path = f"{dest}/{name}"
    _TRACKED.discard(path)
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    f = unreal.AnimSequenceFactory()
    f.set_editor_property("target_skeleton", skel_mesh.get_editor_property("skeleton"))
    f.set_editor_property("preview_skeletal_mesh", skel_mesh)
    return AT.create_asset(name, dest, unreal.AnimSequence, f)


def _key_sequence(seq, D, S, frames):
    """Key the solved pose; with frames > 1 a seamless breathing loop (the last key repeats the first). Rotations come
    from the solver; translations are the skeleton's reference (D["key_t"]), except the dropped pelvis."""
    names, key_t = D["names"], D["key_t"]
    keys = []
    for f in range(frames):
        if f == 0:
            keys.append(S["new_l"])
        else:
            keys.append(S["solve"](_idle_deltas(S["deltas"], f, frames, S["order"], S["parent"]))[1])
    keys.append(keys[0])
    ctrl = seq.controller
    ctrl.open_bracket(unreal.Text("TC seated pose"), False)
    ctrl.set_frame_rate(unreal.FrameRate(IDLE_FPS, 1), False)
    ctrl.set_number_of_frames(unreal.FrameNumber(frames), False)
    sv = unreal.Vector(1, 1, 1)
    key = seq.get_path_name().split(".")[0]
    first = key not in _TRACKED  # the closed loop keys the same sequence again: add each track once
    _TRACKED.add(key)
    for b in names:
        if first:
            ctrl.add_bone_curve(b, False) if not hasattr(ctrl, "add_bone_track") else ctrl.add_bone_track(b, False)
        tk = [unreal.Vector(*(k[b][0] if b == "pelvis" else key_t[b])) for k in keys]
        ctrl.set_bone_track_keys(b, tk, [unreal.Quat(*k[b][1]) for k in keys], [sv] * len(keys), False)
    ctrl.close_bracket(False)


def _evaluate_on_mesh(seq, skel_mesh, names):
    """The authored sequence evaluated on the target mesh as the game plays it (the skeleton's translation retargeting
    applied): bone -> ((local t, q), (component t, q)). None if this engine's Python cannot do it."""
    try:
        opts = unreal.AnimPoseEvaluationOptions()
        opts.set_editor_property("optional_skeletal_mesh", skel_mesh)
        try:
            opts.set_editor_property("should_retarget", True)
        except Exception:
            pass
        pose = unreal.AnimPoseExtensions.get_anim_pose_at_time(seq, 0.0, opts)
        have = {str(n) for n in unreal.AnimPoseExtensions.get_bone_names(pose)}
        return {b: (_xf(unreal.AnimPoseExtensions.get_bone_pose(pose, b, unreal.AnimPoseSpaces.LOCAL)),
                    _xf(unreal.AnimPoseExtensions.get_bone_pose(pose, b, unreal.AnimPoseSpaces.WORLD))) for b in names if b in have}
    except Exception:
        log("WARNING pose evaluation on the mesh failed\n" + traceback.format_exc())
        return None


POSE_CHECK_BONES = ("pelvis", "head", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r", "index_03_l", "middle_03_l", "pinky_03_l",
                    "thumb_03_l", "index_03_r", "middle_03_r", "pinky_03_r", "thumb_03_r")


def build_seated_pose(skel_mesh, base_anim, dest, name, own_proportions=False, pose_name="rest"):
    """Authors a seated pose for the UE5 mannequin / MetaHuman body (one frame, or a breathing loop for IDLE_POSES).

    Starts from MM_Idle frame 0, infers the bone hierarchy from local vs component transforms, applies
    component-space rotations (mannequin faces +Y, up is +Z), re-derives local transforms and keys them into a new
    AnimSequence. Deltas are about the component X axis: +90 swings a hanging limb forward.

    C5 closed loop (own_proportions): the solver's bone lengths came from the skeleton's reference pose, but the game
    plays the sequence on the mesh with the skeleton's translation retargeting: every keyed translation is scaled to the
    mesh (C1 probe: forearm 25.9 cm at runtime against 23.0 in the solver, fingertips 6-9 cm further forward than
    predicted, the body 15-18 cm higher). Pass 0 keys the reference translations and evaluates the sequence on the mesh
    (the editor evaluation matched the game's probe within 0.1 cm on every probed bone, C5 s1); the solver then takes the
    evaluated lengths and pelvis offset as its model (the keys stay at the reference) and solves again; the residual
    between model and evaluation is logged."""
    D = _pose_inputs(skel_mesh, base_anim, own_proportions, pose_name)
    SEATED_IDLE_HEAD["q0"] = D["wld"]["head"][1] if "head" in D["wld"] else None
    seq = _new_sequence(skel_mesh, dest, name)
    frames = max(1, int(round(IDLE_SECONDS * IDLE_FPS))) if pose_name in IDLE_POSES and IDLE_AMP > 0 else 1
    loop = own_proportions and os.environ.get("TC_POSE_LOOP", "1") == "1"
    passes = int(os.environ.get("TC_POSE_PASSES", 3)) if loop else 1
    ev, res = None, {}
    for it in range(passes):
        S = solve_seated_pose(D, pose_name)
        _key_sequence(seq, D, S, 1)
        if not loop:
            break
        ev = _evaluate_on_mesh(seq, skel_mesh, D["names"])
        if not ev:
            break
        res = {b: _vlen(_vsub(S["new_w"][b][0], ev[b][1][0])) for b in POSE_CHECK_BONES if b in ev and b in S["new_w"]}
        rot = max((_angle_deg(S["new_l"][b][1], ev[b][0][1]) for b in D["names"] if b in ev), default=0.0)
        log("pose loop", name, "pass", it, "model vs evaluated (cm):", {k: round(v, 2) for k, v in res.items()},
            "max local rotation diff", round(rot, 2), "deg")
        if (max(res.values()) if res else 0.0) < 0.3 or it == passes - 1:
            break
        # the model takes the evaluated bone lengths (all but the pelvis) and the pelvis offset; the keys do not change,
        # so the evaluated lengths do not either and the next pass only has to follow the pelvis
        for b in D["names"]:
            if b in ev and b != "pelvis" and D["parent"].get(b):
                D["loc"][b] = (ev[b][0][0], D["loc"][b][1])
        if "pelvis" in ev:
            pb = D["pelvis_bias"]
            dp = _vsub(ev["pelvis"][1][0], S["new_w"]["pelvis"][0])
            D["pelvis_bias"] = (pb[0] + dp[0], pb[1] + dp[1], pb[2] + dp[2])
            log("pose loop", name, "pelvis bias", [round(v, 2) for v in D["pelvis_bias"]])
    if frames > 1:
        _key_sequence(seq, D, S, frames)
    if res and max(res.values()) >= 0.5:
        log("WARNING pose loop", name, "did not converge: worst", round(max(res.values()), 2), "cm")
    SEATED[f"{pose_name}:calibrated"] = bool(ev) and bool(res) and max(res.values()) < 0.5
    new_w = S["new_w"]
    dump = os.environ.get("TC_POSE_DUMP")
    if dump:
        try:
            import json
            os.makedirs(dump, exist_ok=True)
            with open(os.path.join(dump, f"{name}.json"), "w") as fh:
                json.dump({"pose": pose_name, "names": D["names"], "parent": D["parent"], "order": D["order"],
                           "loc": D["loc"], "wld": D["wld"], "pelvis_bias": D["pelvis_bias"], "seat": SEAT,
                           "model": {b: new_w[b] for b in new_w},
                           "evaluated": {b: ev[b][1] for b in ev} if ev else None}, fh)
            log("pose dump", os.path.join(dump, f"{name}.json"))
        except Exception:
            log("WARNING pose dump failed\n" + traceback.format_exc())

    # head in the seated pose (component space) and its idle orientation, for props attached to the head bone
    SEATED["head"] = (new_w["head"][0], new_w["head"][1], D["wld"]["head"][1])
    for b_ in ("spine_03", "spine_05", "pelvis"):
        if b_ in new_w:
            SEATED[b_] = (new_w[b_][0], new_w[b_][1], D["wld"][b_][1])
    EAL.save_loaded_asset(seq)
    log("seated pose", f"{dest}/{name}", len(D["names"]), "bones,", frames, "frames; pelvis", new_w.get("pelvis", ((0, 0, 0),))[0],
        "head", new_w.get("head", ((0, 0, 0),))[0], "hand_l", new_w.get("hand_l", ((0, 0, 0),))[0])
    return seq


# ---------------------------------------------------------------- lights / camera / post

def spot(label, loc, rot, lumens, kelvin, radius, cone, src=2.0, vol=1.0, shadows=True):
    rot = rot if isinstance(rot, unreal.Rotator) else unreal.Rotator(*rot)
    a = EAS.spawn_actor_from_class(unreal.SpotLight, unreal.Vector(*loc), rot)
    c = a.spot_light_component
    setp(c, "intensity_units", unreal.LightUnits.LUMENS)
    setp(c, "intensity", lumens)
    setp(c, "use_temperature", True)
    setp(c, "temperature", kelvin)
    setp(c, "attenuation_radius", radius)
    setp(c, "outer_cone_angle", cone)
    setp(c, "inner_cone_angle", cone * 0.55)
    setp(c, "source_radius", src)
    setp(c, "soft_source_radius", src * 2)
    setp(c, "volumetric_scattering_intensity", vol)
    setp(c, "cast_shadows", shadows)
    a.set_actor_label(label)
    a.set_folder_path("Lights")
    return a


def rect(label, loc, rot, lumens, kelvin, w, h, radius, vol=0.3, shadows=False):
    rot = rot if isinstance(rot, unreal.Rotator) else unreal.Rotator(*rot)
    a = EAS.spawn_actor_from_class(unreal.RectLight, unreal.Vector(*loc), rot)
    c = a.rect_light_component
    setp(c, "intensity_units", unreal.LightUnits.LUMENS)
    setp(c, "intensity", lumens)
    setp(c, "use_temperature", True)
    setp(c, "temperature", kelvin)
    setp(c, "source_width", w)
    setp(c, "source_height", h)
    setp(c, "attenuation_radius", radius)
    setp(c, "volumetric_scattering_intensity", vol)
    setp(c, "cast_shadows", shadows)  # pass C2: only the lamp's two spots cast shadows (each shadowed fill cost 0.2-0.6 ms of RT rays + denoiser)
    a.set_actor_label(label)
    a.set_folder_path("Lights")
    return a


def point(label, loc, lumens, kelvin, radius, src=1.0, shadows=True):
    a = EAS.spawn_actor_from_class(unreal.PointLight, unreal.Vector(*loc), unreal.Rotator(0, 0, 0))
    c = a.point_light_component
    setp(c, "intensity_units", unreal.LightUnits.LUMENS)
    setp(c, "intensity", lumens)
    setp(c, "use_temperature", True)
    setp(c, "temperature", kelvin)
    setp(c, "attenuation_radius", radius)
    setp(c, "source_radius", src)
    setp(c, "cast_shadows", shadows)
    a.set_actor_label(label)
    a.set_folder_path("Lights")
    return a


def look_at_rot(src, dst):
    dx, dy, dz = (dst[i] - src[i] for i in range(3))
    yaw = math.degrees(math.atan2(dy, dx))
    pitch = math.degrees(math.atan2(dz, math.hypot(dx, dy)))
    return unreal.Rotator(0, pitch, yaw)  # Rotator(roll, pitch, yaw)


# ---------------------------------------------------------------- scene

SKIN_DIR = os.environ.get("TC_SKIN_DIR", os.path.join(os.path.dirname(ASSETS), "skin"))


def player_skins(mhn):
    """MI_PlayerSkin_<variant>: children of the cinematic body material with our skin layers (veins, tendons, nail
    grime, dirt, scars) baked into its base colour and normal by ue5/tools/textures/skin.py. The PNGs are derived from
    Epic's MetaHuman textures, so they live in the workspace ($TC_SKIN_DIR), not in the repo. Imported once (an 8K
    normal takes minutes); TC_SKIN_REIMPORT=1 re-imports after regenerating."""
    out = {}
    root = f"/Game/TownChess/MetaHumans/BuiltCine/{mhn}/Body/Materials/MI_Body_Baked_VT"
    parent = unreal.load_asset(root) if EAL.does_asset_exist(root) else None
    if not parent or not os.path.isdir(SKIN_DIR):
        log("no player skins (", root, SKIN_DIR, ")")
        return out
    dest = f"{ROOT}/Characters/PlayerSkin"
    mel = unreal.MaterialEditingLibrary
    try:  # C6: which inputs the cinematic body material exposes (skin roughness from the dirt mask needs one)
        log("skin parent params: tex", [str(n) for n in mel.get_texture_parameter_names(parent)],
            "scalar", [str(n) for n in mel.get_scalar_parameter_names(parent)])
    except Exception as e:
        log("skin parent params unavailable", e)
    reimport = os.environ.get("TC_SKIN_REIMPORT", "0") == "1"
    for f in sorted(os.listdir(SKIN_DIR)):
        if not (f.startswith("T_PlayerSkin_") and f.endswith("_BC.png")):
            continue
        var = f[len("T_PlayerSkin_"):-len("_BC.png")]
        texs = {}
        for kind, suffix in (("color", "BC"), ("normal", "N")):
            name = f"T_PlayerSkin_{var}_{suffix}"
            src = os.path.join(SKIN_DIR, name + ".png")
            if reimport or not EAL.does_asset_exist(f"{dest}/{name}"):
                if not os.path.exists(src):
                    break
                tex = import_texture(src, dest, name, kind)
                tex.set_editor_property("virtual_texture_streaming", True)  # the parent samples them as virtual textures
                tex.set_editor_property("lod_group", unreal.TextureGroup.TEXTUREGROUP_CHARACTER_NORMAL_MAP if kind == "normal"
                                        else unreal.TextureGroup.TEXTUREGROUP_CHARACTER)
                EAL.save_loaded_asset(tex)
            texs[suffix] = unreal.load_asset(f"{dest}/{name}")
        if len(texs) < 2:
            continue
        mi = AT.create_asset(f"MI_PlayerSkin_{var}", dest, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew()) \
            if not EAL.does_asset_exist(f"{dest}/MI_PlayerSkin_{var}") else unreal.load_asset(f"{dest}/MI_PlayerSkin_{var}")
        mel.set_material_instance_parent(mi, parent)
        mel.set_material_instance_texture_parameter_value(mi, "Basecolor Baked VT", texs["BC"])
        mel.set_material_instance_texture_parameter_value(mi, "Normal Baked VT", texs["N"])
        EAL.save_loaded_asset(mi)
        out[var] = mi
    log("player skins", sorted(out))
    return out


def outfit_slot_material(spec, orig):
    """The outfit colour `spec` (an M_TC_PBR instance: its Tint) on a MetaHuman garment slot, as a child of the slot's
    own garment material so the garment's fold/seam normals, AO, weave micro-normals and fuzz stay (pass C3; before,
    the flat M_TC_PBR instance replaced every slot and the patient's torso had no fold in the normal buffer)."""
    if not (spec and orig) or "DefaultGarment" not in orig.get_path_name():
        return spec
    name = f"{spec.get_name()}_{orig.get_name()}"
    dest = f"{ROOT}/Characters/Outfit"
    path = f"{dest}/{name}"
    if path in _OUTFIT_MIS:
        return _OUTFIT_MIS[path]
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    try:
        tint = MEL.get_material_instance_vector_parameter_value(spec, "Tint")
    except Exception:
        return spec
    mi = AT.create_asset(name, dest, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    MEL.set_material_instance_parent(mi, orig)
    # the garment shader brightens its colours (Tint 0.42/0.40/0.34 as diffuse_color read near-white in the base-colour
    # buffer, first C3 try): half the M_TC_PBR tint gives the drab, used off-white of the flat instance
    col = unreal.LinearColor(tint.r * 0.5, tint.g * 0.5, tint.b * 0.5, 1.0)
    for p in ("diffuse_color_1", "diffuse_color_2", "B_diffuse_color_1"):
        MEL.set_material_instance_vector_parameter_value(mi, p, col)
    MEL.update_material_instance(mi)
    EAL.save_loaded_asset(mi)
    log("outfit material", name)
    _OUTFIT_MIS[path] = mi
    return mi


_OUTFIT_MIS = {}


METAL_ARM = None


def build():
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    level_path = f"{ROOT}/{LEVEL}"
    # The project opens L_Bench at startup, so it cannot be deleted/recreated in place (NewLevel refuses: "an asset
    # already exists"), and actors would land in an unsaved transient world. Load it and clear it instead.
    if EAL.does_asset_exist(level_path):
        if not LES.load_level(level_path):
            raise RuntimeError(f"could not load {level_path}")
        keep = (unreal.WorldSettings, unreal.Brush)
        # volumes are Brush subclasses: keeping them left one PostProcessVolume per build (70 by pass 54, the oldest with
        # EV 8.5 and no grading was what captures and the game used, so grading changes since pass 28 had no effect)
        doomed = [a for a in EAS.get_all_level_actors() if not isinstance(a, keep) or isinstance(a, unreal.Volume)]
        EAS.destroy_actors(doomed)
        log("cleared", len(doomed), "actors from", level_path)
    elif not LES.new_level(level_path):
        raise RuntimeError(f"could not create {level_path}")
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    if not world.get_path_name().startswith(level_path):
        raise RuntimeError(f"editing {world.get_path_name()} instead of {level_path}")

    # Defaults for the master material.
    tmp = tempfile.mkdtemp()
    png(os.path.join(tmp, "T_TC_White.png"), 4, 4, (255, 255, 255, 255))
    png(os.path.join(tmp, "T_TC_FlatNormal.png"), 4, 4, (128, 128, 255, 255))
    png(os.path.join(tmp, "T_TC_DefaultARM.png"), 4, 4, (255, 160, 0, 255))
    defaults = {
        "white": import_texture(os.path.join(tmp, "T_TC_White.png"), f"{ROOT}/Textures", "T_TC_White", "color"),
        "normal": import_texture(os.path.join(tmp, "T_TC_FlatNormal.png"), f"{ROOT}/Textures", "T_TC_FlatNormal", "normal"),
        "arm": import_texture(os.path.join(tmp, "T_TC_DefaultARM.png"), f"{ROOT}/Textures", "T_TC_DefaultARM", "linear"),
    }
    png(os.path.join(tmp, "T_TC_Black.png"), 4, 4, (0, 0, 0, 255))
    defaults["black"] = import_texture(os.path.join(tmp, "T_TC_Black.png"), f"{ROOT}/Textures", "T_TC_BlackMask", "linear")
    # metallic = ARM.B x MetallicScale, and the default ARM has B = 0: every untextured "metal=1" instance rendered as a
    # dielectric (pass 60: the board's brass corners read as paper). Metal parts without maps take this ARM instead.
    png(os.path.join(tmp, "T_TC_MetalARM.png"), 4, 4, (255, 160, 255, 255))
    global METAL_ARM
    METAL_ARM = import_texture(os.path.join(tmp, "T_TC_MetalARM.png"), f"{ROOT}/Textures", "T_TC_MetalARM", "linear")
    defaults["gray"] = import_texture(os.path.join(tmp, "T_TC_White.png"), f"{ROOT}/Textures", "T_TC_WhiteGray", "gray")
    grime_png(os.path.join(tmp, "T_TC_Grime.png"))
    defaults["grime"] = import_texture(os.path.join(tmp, "T_TC_Grime.png"), f"{ROOT}/Textures", "T_TC_Grime", "linear")
    # handling-detail maps generated by ue5/tools/textures/blood.py (tileable): the master's DetailNormal / DetailMask
    gdir = os.path.join(TEXTURES_DIR, "grime")
    if os.path.exists(os.path.join(gdir, "T_HandlingGrime_Normal.png")):
        defaults["detail_normal"] = import_texture(os.path.join(gdir, "T_HandlingGrime_Normal.png"), f"{ROOT}/Textures/Grime", "T_HandlingGrime_Normal", "normal")
        defaults["detail_mask"] = import_texture(os.path.join(gdir, "T_HandlingGrime_Mask.png"), f"{ROOT}/Textures/Grime", "T_HandlingGrime_Mask", "linear")
    master = build_master_material(defaults)

    mi_floor = surface_material(master, "old_linoleum_flooring_01", tiling=3.0, tint=(0.55, 0.55, 0.48),
                                scalars={"GrimeTiling": 0.6, "GrimeThreshold": 0.45, "GrimeContrast": 2.0})
    mi_wall = surface_material(master, "damaged_plaster", tiling=2.0, tint=(0.55, 0.6, 0.52), grime_color=(0.35, 0.3, 0.22),
                               scalars={"GrimeTiling": 0.8, "GrimeThreshold": 0.38, "GrimeContrast": 1.8, "GrimeStreaks": 0.6})
    mi_wall_low = surface_material(master, "dirty_tiles", tiling=3.0, tint=(0.62, 0.66, 0.6), grime_color=(0.3, 0.26, 0.18),
                                   scalars={"GrimeTiling": 0.7, "GrimeThreshold": 0.35, "GrimeContrast": 1.6, "GrimeStreaks": 0.7})
    mi_rust = surface_material(master, "rusty_metal_02", tiling=1.0, metal=1.0, tint=(0.5, 0.45, 0.4),
                               scalars={"GrimeTiling": 2.0, "GrimeThreshold": 0.45, "GrimeContrast": 2.0})
    # cell bars: the same scan darkened (stretched once round a thin cylinder it read as tan wood in the base colour)
    mi_bar = surface_material(master, "rusty_metal_02", name="MI_BarIron", tiling=3.0, metal=0.6, tint=(0.16, 0.145, 0.135), rough=0.8,
                              scalars={"GrimeTiling": 2.0, "GrimeThreshold": 0.55, "GrimeContrast": 2.0})
    mi_cloth = surface_material(master, "rough_linen", name="MI_OpponentCloth", tiling=6.0, tint=(0.25, 0.155, 0.09), grime_color=(0.35, 0.25, 0.16),
                                scalars={"GrimeTiling": 1.5, "GrimeThreshold": 0.35, "GrimeContrast": 2.0, "GrimeStreaks": 0.5})
    mi_leather = surface_material(master, "brown_leather", name="MI_Gloves", tiling=4.0, tint=(0.38, 0.28, 0.2), rough=0.8,
                                  scalars={"GrimeTiling": 2.0, "GrimeThreshold": 0.4, "GrimeContrast": 2.0, "MicroRough": 0.2})
    mi_ceiling = make_mi(master, "MI_ceiling", {"BaseColor": None}, tint=(0.22, 0.22, 0.2), rough=0.9)
    surface_material(master, "wood_table_worn", tiling=1.0)

    # ---- Room: 5.2 m x 4.4 m x 3.0 m, player at -X looking +X.
    L, W, H = 520.0, 440.0, 300.0
    cx = 60.0
    box("Floor", (cx, 0, -5), (L, W, 10), mi_floor)
    box("Ceiling", (cx, 0, H + 5), (L, W, 10), mi_ceiling)
    box("Wall_Back", (cx + L / 2 + 5, 0, H / 2), (10, W, H), mi_wall)
    box("Wall_Front", (cx - L / 2 - 5, 0, H / 2), (10, W, H), mi_wall)
    box("Wall_Left", (cx, -W / 2 - 5, H / 2), (L, 10, H), mi_wall)
    box("Wall_Right", (cx, W / 2 + 5, H / 2), (L, 10, H), mi_wall)
    # Institutional wainscot band (darker, cracked concrete) along the back and side walls.
    box("Wainscot_Back", (cx + L / 2 - 1, 0, 70), (4, W, 140), mi_wall_low)
    box("Wainscot_Left", (cx, -W / 2 + 1, 70), (L, 4, 140), mi_wall_low)
    box("Wainscot_Right", (cx, W / 2 - 1, 70), (L, 4, 140), mi_wall_low)

    # ---- Table, centred at origin; its top height drives everything else.
    table = import_model("wooden_table_02")
    # tiling 1 -> 2.5, normal x1.6 (pass 56): one 2K scan stretched over 1.5 m left the table edges flat next to the reference
    # C4.1: tint 0.7/0.6/0.5 -> 0.68/0.6/0.52 (a greyer worn oak, as the reference): hiding the lamp bulb took its white
    # out of the frame and put g/b at 1.704-1.718 (V1 <= 1.70) and the Black seat's r/g at 1.50
    assign(table, surface_material(master, "wood_table_worn", tiling=3.5, grime_color=(0.3, 0.22, 0.15), tint=(0.68, 0.6, 0.52),
                                   scalars={"GrimeTiling": 1.3, "GrimeThreshold": 0.22, "GrimeContrast": 1.8,
                                            "GrimeStreaks": 0.65, "MicroRough": 0.2, "NormalStrength": 2.2}))
    tlo, thi = bounds_of(table)
    # Long side runs across the player's view (along Y). Poly Haven models are centred on their origin in XY.
    yaw = 90.0 if (thi[0] - tlo[0]) > (thi[1] - tlo[1]) else 0.0
    place_model(table, (0, 0, 0), yaw=yaw, label="Table", sit_on=0.0)
    top = thi[2] - tlo[2]
    log("table bounds", tlo, thi, "top", top)

    # ---- Chess set: board + 32 pieces; rotate so White faces the player (-X).
    chess = import_model("chess_set")
    # Hero materials: scanned maps + handling wear (micro smudges on the pieces, grime worked into the board)
    # pass C3 (materials audit: "black plastic and clean satin ivory"). Scan diffuse file means: white 0.75, black 0.18;
    # both roughness maps median 0.29. The 8K diffuse PNGs come in linear (the base-colour buffer showed the black
    # pieces at tint x 0.18, not x 0.027: a first C3 try with tint 1.3 rendered them light grey), so tints are against
    # 0.18 / 0.75 as linear values.
    # White = aged boxwood: yellower than the old ivory tint and brighter
    # (linear ~0.51/0.46/0.38 vs 0.39/0.34/0.26: more albedo for the specular the rougher varnish no longer gives;
    # a yellower 0.7/0.6/0.42 pushed the C2.3 frame to r/g 1.50-1.51, g/b 1.70;
    # 0.56/0.45/0.27 and 0.64/0.55/0.38 at roughness 0.40 read tan next to the black pieces under the C2.2 light),
    # satin varnish roughness ~0.33 (0.29 x 1.15; was ~0.21, the frame's hottest speculars)
    # C6 (rook-crown specks, V5): baked AO as the ARM (cavity term: crenel walls and piece crevices darker, duller) and
    # Toksvig roughness mips (model_material). The crown-floor specks are lighting, not material: the base-colour buffer
    # is clean there and the final image shows stochastic soft-shadow/GI stipple (C6-rooks.jpg); the master's detail fade
    # (DetailFadeInv 30) and pixel-footprint spec AA (SpecAA 20) changed nothing visible on them and cost static V2 detail
    # (9.19 -> 9.13), so they stay available in M_TC_PBR but are off here.
    piece_aa = {"CavityDarken": 0.9, "CavityRough": 0.5, "CavitySpec": 0.9}
    pdir = os.path.join(TEXTURES_DIR, "pieces")
    mi_pw = model_material(master, "chess_set", "chess_set_pieces_white", "MI_PiecesWhite", grime_color=(0.42, 0.3, 0.17), tint=(0.68, 0.61, 0.5), rough=1.15,
                           arm=os.path.join(pdir, "T_PiecesWhite_ARM.png"), scalars={**piece_aa, "GrimeTiling": 3.0, "GrimeThreshold": 0.58, "GrimeContrast": 2.2, "MicroRough": 0.22, "GrimeStreaks": 0.3,
                                    "GrimeRoughness": 0.6, "DetailTiling": 3.0, "DetailNormalStrength": 0.35, "DetailRough": 0.2, "DetailDarken": 0.1})
    # Black = ebony / dark stained wood: albedo ~0.03 linear, dark brown (0.18/0.155/0.135 x 0.18; was a neutral 0.11 ->
    # ~0.02), roughness ~0.42 (0.29 x 1.45; was ~0.16, the mirror-streak "black plastic") varied by the micro and
    # handling layers; the grime layer lightens (worn varnish, paler wood showing at rims)
    mi_pb = model_material(master, "chess_set", "chess_set_pieces_black", "MI_PiecesBlack", grime_color=(1.6, 1.35, 1.15), rough=1.45, tint=(0.18, 0.155, 0.135),
                           arm=os.path.join(pdir, "T_PiecesBlack_ARM.png"), scalars={**piece_aa, "GrimeTiling": 3.0, "GrimeThreshold": 0.62, "GrimeContrast": 2.0, "MicroRough": 0.25, "GrimeStreaks": 0.2,
                                    "GrimeRoughness": 0.62, "DetailTiling": 3.0, "DetailNormalStrength": 0.35, "DetailRough": 0.22, "DetailDarken": 0.0})
    mi_cb = model_material(master, "chess_set", "chess_set_board", "MI_ChessBoard", grime_color=(0.36, 0.25, 0.16), tint=(0.8, 0.63, 0.44),
                           scalars={"GrimeTiling": 1.7, "GrimeThreshold": 0.3, "GrimeContrast": 2.5, "MicroRough": 0.2})
    assign(chess, mi_pw, lambda n: "white" in n)
    assign(chess, mi_pb, lambda n: "black" in n)
    assign(chess, mi_cb, lambda n: "board" in n)
    king_w = next((m for m in chess if "king_white" in m.get_name()), None)
    cyaw = 0.0
    if king_w:
        b = king_w.get_bounding_box()
        kx, ky = (b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2
        cyaw = math.degrees(math.atan2(0, -1) - math.atan2(ky, kx))
        log("white king at", kx, ky, "-> yaw", cyaw)
    if GAMEPLAY:
        board = EAS.spawn_actor_from_class(unreal.TCBoard, unreal.Vector(0, 0, top), unreal.Rotator(0, 0, 0))
        board.set_actor_label("Board")
        setp(board, "marker_material", marker_material())  # soft translucent discs instead of opaque "stickers" (visual judge run 3)
        names = {"pawn": "p", "knight": "n", "bishop": "b", "rook": "r", "queen": "q", "king": "k"}
        meshes = {}
        for m in chess:
            n = m.get_name().lower()
            if "board" in n:
                setp(board, "board_mesh", m)
                continue
            colour = "w" if "white" in n else "b" if "black" in n else None
            kind = next((v for k, v in names.items() if k in n), None)
            if colour and kind and (colour + kind) not in meshes:
                meshes[colour + kind] = m
        setp(board, "piece_meshes", meshes)
        snd_dir = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "sounds"))
        for prop, f in (("move_sound", "S_TC_Move.wav"), ("capture_sound", "S_TC_Capture.wav")):
            if os.path.exists(os.path.join(snd_dir, f)):
                snd = next((o for o in import_file(os.path.join(snd_dir, f), f"{ROOT}/Audio") if isinstance(o, unreal.SoundWave)), None)
                if snd:
                    setp(board, prop, snd)  # our synthesised wooden knocks (ue5/tools/audio/clack.py)
        # ward ambience (loop) and the end-of-game sting (ue5/tools/audio/ambience.py); ATCGameMode loads them by path
        # (/Game/TownChess/Audio is always cooked), so save them explicitly: nothing in the level references them
        for f, loop in (("S_TC_Ambience.wav", True), ("S_TC_Sting.wav", False)):
            if os.path.exists(os.path.join(snd_dir, f)):
                snd = next((o for o in import_file(os.path.join(snd_dir, f), f"{ROOT}/Audio") if isinstance(o, unreal.SoundWave)), None)
                if snd:
                    setp(snd, "looping", loop)
                    EAL.save_loaded_asset(snd)
        setp(board, "board_mesh_yaw", 90.0)  # a1 must be a dark square ("light on the right"), checked by screenshot
        # playing surface: our baked composite of CC0 maple/walnut scans (ue5/tools/textures/board.py) on the board's 0..1 grid
        bd = os.path.join(TEXTURES_DIR, "board")
        squares = None
        if os.path.exists(os.path.join(bd, "T_Board_BaseColor.jpg")):
            squares = make_mi(master, "MI_BoardSquares", {
                "BaseColor": import_texture(os.path.join(bd, "T_Board_BaseColor.jpg"), f"{ROOT}/Textures/Board", "T_Board_BaseColor", "color"),
                "Normal": import_texture(os.path.join(bd, "T_Board_Normal.jpg"), f"{ROOT}/Textures/Board", "T_Board_Normal", "normal"),
                "ARM": import_texture(os.path.join(bd, "T_Board_ARM.jpg"), f"{ROOT}/Textures/Board", "T_Board_ARM", "linear")},
                rough=0.85, tint=(0.42, 0.4, 0.36), grime_color=(0.3, 0.22, 0.14),  # pass 54: light squares were 1/4 of the pixels above the ref p95
                scalars={"MicroRough": 0.1, "GrimeTiling": 2.2, "GrimeThreshold": 0.55, "GrimeContrast": 2.2, "GrimeStreaks": 0.2})
        wood_board = import_prop("chess_board") if squares else None
        if wood_board:
            mi_frame = surface_material(master, "wood_cabinet_worn_long", name="MI_BoardFrame", tiling=2.0, tint=(0.55, 0.42, 0.32),
                                        scalars={"GrimeTiling": 2.0, "GrimeThreshold": 0.35, "GrimeContrast": 2.0, "MicroRough": 0.15}) \
                if os.path.isdir(os.path.join(ASSETS, "textures", "wood_cabinet_worn_long")) else surface_material(master, "wood_table_worn", name="MI_BoardFrame", tint=(0.45, 0.34, 0.26))
            mi_brass_b = make_mi(master, "MI_BoardBrass", {"BaseColor": None, "ARM": METAL_ARM}, metal=1.0, rough=1.2, tint=(0.42, 0.29, 0.1),
                                 # aged dull brass: tint 0.72/0.52/0.26 at rough 0.38 mirrored the lamp as cream "paper" (judge run 4)
                                 grime_color=(0.3, 0.25, 0.18), scalars={"GrimeTiling": 5.0, "GrimeThreshold": 0.6, "GrimeContrast": 2.0, "MicroRough": 0.2})
            sm = wood_board[0]
            for i, sl in enumerate(sm.static_materials):
                n = str(sl.material_slot_name).lower()
                sm.set_material(i, squares if "square" in n else mi_brass_b if "brass" in n else mi_frame)
            EAL.save_loaded_asset(sm)
            setp(board, "board_mesh", sm)
            setp(board, "board_mesh_yaw", float(os.environ.get("TC_BOARD_YAW", 0.0)))
            log("wooden board in use")
        log("board pieces", sorted(meshes.keys()))
    else:
        place_model(chess, (0, 0, 0), yaw=cyaw, label="Chess", sit_on=top)

    # ---- Props with intentional placement.
    # Dome desk lamp (props.py): upper-left of frame, arm reaching towards the board; the key light sits at its bulb.
    lamp = import_prop("dome_lamp")
    mi_brass = surface_material(master, "rusty_metal_02", name="MI_Brass", tiling=1.5, metal=1.0, tint=(0.8, 0.6, 0.32), rough=0.7,
                                scalars={"GrimeTiling": 2.0, "GrimeThreshold": 0.5, "GrimeContrast": 2.0, "MicroRough": 0.15})
    # C4: at the fixed exposure (EV 8.45) an unlit emissive of ~240 renders as scene white, so the old bulb (60) read
    # mid-grey and the inner face (2.5) black ("the lamp is dead as a light source", judge baseline finding 3). The bulb
    # now clips to a warm white and the inside of the shade glows; both are on the head mesh, which neither casts
    # shadows nor feeds Lumen/ray tracing (below), so the rendering architect's lights stay what lights the scene.
    bulb_mat = emissive_material("M_TC_Bulb", (1.0, 0.86, 0.62), float(os.environ.get("TC_BULB", 2000.0)))
    # pass 61: dark green enamel worn to rust (the blotchy orange brass shade read cheap: judge run 4) and a warm
    # glowing inner face; the bulb now sits up inside the dome
    # C4.1: worn metal: more metallic and smoother so the dome takes highlights from the lamp's own bulb light
    mi_enamel = surface_material(master, "rusty_metal_02", name="MI_LampEnamel", tiling=1.5, metal=0.75, tint=(0.2, 0.21, 0.16), rough=0.5,
                                 grime_color=(1.8, 1.2, 0.7), scalars={"GrimeTiling": 2.5, "GrimeThreshold": 0.62, "GrimeContrast": 2.5, "MicroRough": 0.15})
    # inside of the shade (C8b, judge run 6 V5 #6: "the mouth is a flat pale grey band that reads as unlit plastic").
    # The (1 - fresnel)^2 emissive of C4/C4.1 was one flat value over the inner face and the rolled rim. Now a lit,
    # glossy cream enamel (Lumen reflects the lit table and board into it) plus a hot core: emission falls off with
    # the distance from the bulb in the mesh's own space (props.py desk_lamp_head: bulb centre at local
    # (23.7, 0.06, 36.45) cm; the inner face lies 4.9 cm (apex) to 9.4 cm (mouth) from it), broken up by the grime
    # mask so it reads as stained enamel. The rim takes the worn brass (MI_Brass) and catches the key light.
    LAMP_INNER = float(os.environ.get("TC_LAMP_INNER", 60.0))
    inner_mat = None
    try:
        path = f"{ROOT}/Materials/M_TC_LampInner"
        if EAL.does_asset_exist(path):
            EAL.delete_asset(path)
        inner_mat = AT.create_asset("M_TC_LampInner", f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew())
        E = lambda cls, x, y: MEL.create_material_expression(inner_mat, cls, x, y)
        lp = E(unreal.MaterialExpressionLocalPosition, -1300, 200)
        bc = E(unreal.MaterialExpressionConstant3Vector, -1300, 350)
        bc.set_editor_property("constant", unreal.LinearColor(23.7, 0.06, 36.45, 1))
        dist = E(unreal.MaterialExpressionDistance, -1150, 250)
        MEL.connect_material_expressions(lp, "", dist, "A")
        MEL.connect_material_expressions(bc, "", dist, "B")
        sub = E(unreal.MaterialExpressionSubtract, -1020, 250); sub.set_editor_property("const_b", 5.0)
        MEL.connect_material_expressions(dist, "", sub, "A")
        sc = E(unreal.MaterialExpressionMultiply, -900, 250); sc.set_editor_property("const_b", 1.0 / 4.6)
        MEL.connect_material_expressions(sub, "", sc, "A")
        sat = E(unreal.MaterialExpressionSaturate, -780, 250)
        MEL.connect_material_expressions(sc, "", sat, "")
        om = E(unreal.MaterialExpressionOneMinus, -660, 250)
        MEL.connect_material_expressions(sat, "", om, "")
        pw = E(unreal.MaterialExpressionPower, -540, 250); pw.set_editor_property("const_exponent", 2.2)
        MEL.connect_material_expressions(om, "", pw, "Base")
        # hot core (1, 0.8, 0.55) x LAMP_INNER at the apex, a low warm floor (x 0.06) at the mouth
        hot = E(unreal.MaterialExpressionMultiply, -420, 250); hot.set_editor_property("const_b", LAMP_INNER)
        MEL.connect_material_expressions(pw, "", hot, "A")
        flo = E(unreal.MaterialExpressionAdd, -300, 250); flo.set_editor_property("const_b", LAMP_INNER * 0.06)
        MEL.connect_material_expressions(hot, "", flo, "A")
        uv = E(unreal.MaterialExpressionTextureCoordinate, -1150, 450)
        uv.set_editor_property("u_tiling", 3.0); uv.set_editor_property("v_tiling", 3.0)
        g = E(unreal.MaterialExpressionTextureSample, -1000, 450)
        g.set_editor_property("texture", defaults["grime"])
        g.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
        MEL.connect_material_expressions(uv, "", g, "UVs")
        gl = E(unreal.MaterialExpressionLinearInterpolate, -800, 450)
        gl.set_editor_property("const_a", 1.0); gl.set_editor_property("const_b", 0.55)
        MEL.connect_material_expressions(g, "R", gl, "Alpha")
        stain = E(unreal.MaterialExpressionMultiply, -180, 300)
        MEL.connect_material_expressions(flo, "", stain, "A")
        MEL.connect_material_expressions(gl, "", stain, "B")
        col = E(unreal.MaterialExpressionConstant3Vector, -180, 450)
        col.set_editor_property("constant", unreal.LinearColor(1.0, 0.8, 0.55, 1))
        em = E(unreal.MaterialExpressionMultiply, -60, 350)
        MEL.connect_material_expressions(stain, "", em, "A")
        MEL.connect_material_expressions(col, "", em, "B")
        MEL.connect_material_property(em, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
        base = E(unreal.MaterialExpressionMultiply, -180, 0)
        base.set_editor_property("const_a", 1.0)
        bcol = E(unreal.MaterialExpressionConstant3Vector, -400, 0)
        bcol.set_editor_property("constant", unreal.LinearColor(0.62, 0.55, 0.42, 1))  # yellowed cream enamel
        MEL.connect_material_expressions(bcol, "", base, "A")
        MEL.connect_material_expressions(gl, "", base, "B")
        MEL.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
        rr = E(unreal.MaterialExpressionLinearInterpolate, -180, 150)
        rr.set_editor_property("const_a", 0.28); rr.set_editor_property("const_b", 0.6)
        MEL.connect_material_expressions(g, "R", rr, "Alpha")
        MEL.connect_material_property(rr, "", unreal.MaterialProperty.MP_ROUGHNESS)
        MEL.recompile_material(inner_mat)
        EAL.save_loaded_asset(inner_mat)
    except Exception as e:
        log("WARNING lamp inner gradient failed, flat emissive instead", e)
        inner_mat = emissive_material("M_TC_LampInner", (1.0, 0.8, 0.55), LAMP_INNER * 0.4)
    lamp_shade = import_prop("dome_lamp_head")  # C4: shade, inner face, bulb (props.py desk_lamp_head, same pivot)
    for sm in lamp + lamp_shade:
        for i, sl in enumerate(sm.static_materials):
            n = str(sl.material_slot_name).lower()
            sm.set_material(i, bulb_mat if "bulb" in n else mi_brass if "rim" in n else inner_mat if "inner" in n else mi_enamel)
        EAL.save_loaded_asset(sm)
    LAMP_BASE, LAMP_YAW = (24.0, -56.0), 101.0
    lamp_actors, llo, lhi = place_model(lamp + lamp_shade, (LAMP_BASE[0], LAMP_BASE[1], 0), yaw=LAMP_YAW, label="Lamp", sit_on=top)
    tag(lamp_actors)
    # the shade now closes round Lamp_Key and Lamp_Opponent (both shadowed): without these flags it would cut the
    # opponent's light (89 deg off the shade's axis) and the emissive would add unplanned bounce light
    for a in lamp_actors[len(lamp):]:
        smc = a.static_mesh_component
        for prop, val in (("cast_shadow", False), ("affect_dynamic_indirect_lighting", False), ("visible_in_ray_tracing", False)):
            setp(smc, prop, val)
    yr = math.radians(LAMP_YAW)
    lamp_bulb = (LAMP_BASE[0] + 24 * math.cos(yr), LAMP_BASE[1] + 24 * math.sin(yr), top + 38.5)
    log("lamp bounds", llo, lhi, "bulb", lamp_bulb)
    clock = import_model("alarm_clock_01")
    if clock:  # this FBX currently imports without a static mesh; skip rather than fail
        place_model(clock, (-8, 46, 0), yaw=-150, label="Clock", sit_on=top)
    # ---- Game record: an asylum medical cart at the right edge of frame; the clipboard rests on it and Tab lifts it
    # to a reading pose (ATCClipboard, docs/CLIPBOARD_CRITIQUE.md).
    # metallic = ARM.B x MetallicScale: without METAL_ARM (B = 0) the "steel" was a grey dielectric (materials audit
    # finding 5, the same bug pass 60 fixed for the brass). Worn institutional steel: f0 ~0.45, roughness ~0.47 varied
    # by grime (matte, darker) and the handling layer (smudges dull it, fingerprints polish it)
    mi_cart = make_mi(master, "MI_CartSteel", {"BaseColor": None, "ARM": METAL_ARM}, metal=1.0, rough=0.75, tint=(0.45, 0.44, 0.42),
                      grime_color=(0.35, 0.29, 0.22), scalars={"GrimeTiling": 3.0, "GrimeThreshold": 0.45, "GrimeContrast": 2.0, "MicroRough": 0.2,
                                                              "GrimeRoughness": 0.8, "DetailTiling": 3.0, "DetailNormalStrength": 0.5, "DetailRough": 0.35})
    mi_rubber = make_mi(master, "MI_Rubber", {"BaseColor": None}, tint=(0.03, 0.03, 0.03), rough=0.8)
    mi_hardboard = make_mi(master, "MI_Hardboard", {"BaseColor": None}, tint=(0.3, 0.2, 0.12), rough=0.75,
                           scalars={"GrimeTiling": 2.0, "GrimeThreshold": 0.45, "GrimeContrast": 2.0, "MicroRough": 0.2})
    # patient-record paper (forms.py): the loose sheets on the table and, since C4, the pad under the clipboard's record
    form = os.path.join(TEXTURES_DIR, "forms", "T_PaperForm_BaseColor.jpg")
    form_tex = import_texture(form, f"{ROOT}/Textures/Forms", "T_PaperForm_BaseColor", "color") if os.path.exists(form) else None
    mi_form = make_mi(master, "MI_PaperForm", {"BaseColor": form_tex},
                      tint=(0.85, 0.82, 0.76), rough=0.92, grime_color=(0.35, 0.27, 0.18),
                      scalars={"GrimeTiling": 2.0, "GrimeThreshold": 0.55, "GrimeContrast": 2.0})
    cart = import_prop("med_cart")
    for sm in cart:
        for i, sl in enumerate(sm.static_materials):
            sm.set_material(i, mi_rubber if "rubber" in str(sl.material_slot_name).lower() else mi_cart)
        EAL.save_loaded_asset(sm)
    CART = (16.0, 80.0)
    cart_actors, cart_lo, cart_hi = place_model(cart, (CART[0], CART[1], 0), yaw=90, label="Cart", sit_on=0.0)
    tag(cart_actors)
    # C4.1: where the cart's top tray really is. The OBJ's pivot is off the cart's centre (mesh bounds x -34..31.5,
    # y -84.7..-44.3), so after the 90 deg yaw the tray is centred at world (CART.x - mid_y, CART.y + mid_x) ~ (80.5, 80),
    # 40 x 60 cm, its face 83.6 cm over the floor (props.py med_cart: tray 0.83 m, 1.2 cm thick; the lowest point is the
    # castors' foot at 0); the push handle (3.5 cm of the mesh's -x) is left out of the centre.
    CART_TRAY = (CART[0] - (cart_lo[1] + cart_hi[1]) / 2, CART[1] + (cart_lo[0] + 3.5 + cart_hi[0]) / 2, 83.6)
    board_mesh = import_prop("clipboard")
    if GAMEPLAY and board_mesh:
        for sm in board_mesh:
            for i, sl in enumerate(sm.static_materials):
                slot = str(sl.material_slot_name).lower()
                sm.set_material(i, mi_cart if "steel" in slot else mi_form if "paper" in slot else mi_hardboard)
            EAL.save_loaded_asset(sm)
        # C4: the clipboard hung in the air: (12, 74, 86.2) is 6 cm above table height beyond the table's side edge
        # (y 56.7) and nowhere near the cart, whose OBJ pivot puts its tray at x ~60-100 (C4-clipboard.jpg: the floor
        # shows under it; the "pale tilted slab" of judge baseline V5 #6). Now flat on the table right of the board
        # (underside -0.2 cm -> 0.05 cm over the top), long side towards the opponent, clear of the right hand
        # (x <= -24), the mug (30, 38) and the tape roll (28, 50); Tab still lifts it from here.
        clip = EAS.spawn_actor_from_class(unreal.TCClipboard, unreal.Vector(8.0, 44.0, top + 0.25), unreal.Rotator(0, 0, -92))
        clip.set_actor_label("GameRecordClipboard")
        clip.get_editor_property("board").set_static_mesh(board_mesh[0])
        stock_tex = None
        if os.path.exists(form):  # C8b: the forms stock without its text, for the record sheet (paper_material)
            stock_tex = import_texture(form, f"{ROOT}/Textures/Forms", "T_PaperStock_BaseColor", "color")
            setp(stock_tex, "max_texture_size", 32)  # 64 px still left the text lines as grey bands
            setp(stock_tex, "mip_gen_settings", unreal.TextureMipGenSettings.TMGS_BLUR5)
            EAL.save_loaded_asset(stock_tex)
        setp(clip, "paper_material", paper_material(stock_tex))
        for prop, ttf, nm in (("hand_face", "PatrickHand-Regular.ttf", "F_TC_Hand"), ("form_face", "CourierPrime-Bold.ttf", "F_TC_Form")):
            face = next((o for o in import_file(os.path.join(FONTS, ttf), f"{ROOT}/Fonts", nm + "_Face") if isinstance(o, unreal.FontFace)), None)
            if face:
                setp(clip, prop, face)  # ATCClipboard builds the runtime font (FontData is not exposed to Python)
            else:
                log("WARNING font face import failed", ttf)
        # HUD portraits (ue5/assets/ui/T_Portrait_<opponent>.png, captured from the game): /Game/TownChess/UI, loaded by
        # path in ATCHUD::Portrait and always cooked; saved explicitly since nothing in the level references them
        ui_dir = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "ui"))
        if os.path.isdir(ui_dir):
            for f in sorted(os.listdir(ui_dir)):
                if f.endswith(".png"):
                    t = import_texture(os.path.join(ui_dir, f), f"{ROOT}/UI", os.path.splitext(f)[0], "color")
                    if t:
                        setp(t, "lod_group", unreal.TextureGroup.TEXTUREGROUP_UI)
                        setp(t, "mip_gen_settings", unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
                        EAL.save_loaded_asset(t)
        # HUD fonts (ATCHUD loads them by path; DefaultGame.ini always cooks /Game/TownChess/Fonts): Lato for play text,
        # Courier Prime Regular for the thin monospace section titles of the reference
        for ttf, nm in (("Lato-Regular.ttf", "F_TC_Sans"), ("Lato-Light.ttf", "F_TC_SansLight"), ("CourierPrime-Regular.ttf", "F_TC_Title")):
            face = next((o for o in import_file(os.path.join(FONTS, ttf), f"{ROOT}/Fonts", nm + "_Face") if isinstance(o, unreal.FontFace)), None)
            if face:
                EAL.save_loaded_asset(face)  # nothing in the level references these, so the level save would not write them
            else:
                log("WARNING HUD font import failed", ttf)
        tag(clip)
    # ---- Wear and clutter on the table: dried blood, papers, a book stack (the reference's table is a lived-in mess)
    blood = blood_decals()
    # C4: every decal here was spawned with unreal.Rotator(-90, yaw, 0), which is (roll, pitch, yaw) in UE Python: roll
    # -90 and the intended yaw as a PITCH, so each decal projected along a tilted or horizontal axis. At pitch ~0 (the
    # knife scars at yaw 0/15/-10/170) a decal box is a 6 cm-thick vertical slab and its texture is smeared along world X
    # into rows of straight parallel hairlines: the judge's "pine needles" (baseline finding 4). Now pitch -90 (straight
    # down) with the yaw as yaw. decal_size is a half extent, so the sizes below (full widths, as the list always meant)
    # are halved, and each decal's depth is kept to its own surface: "board" decals (on the squares/frame, z +1.71/+1.92)
    # span top+1.1..2.9 and never reach the table; "table" decals span top-1.3..+1.5 and never reach the board's top or
    # the pieces. Table decals keep their boxes off the board frame's vertical sides (|x|,|y| 27.65) and out of the
    # resting hands (x -40..-24, |y| 13-38); table extent x +-35.3, y +-56.7 (bounds log), so the old ones at x 38-44
    # had nothing to land on but the opponent's arms or the player's. Moved entries say where they were.
    placements = [  # variant, x, y, full width along the decal's Y, full width along its Z (None: square), yaw, level
        ("Spatter", -4, -10, 14, None, 75, "board"),
        ("Pool", -15, 42, 12, None, 140, "table"),        # was (-30, 34, 18): over the right hand
        ("Spatter", 30.0, -34, 6, None, 300, "table"),     # was (30, -30, 12): across the far frame's side; C8b 31.8 -> 30
        ("Smear", -10, -44, 16, None, 160, "table"),       # was (-28, -40, 22): under the left hand
        ("Spatter", 20, 40, 10, None, 40, "table"),
        # pass 49: the reference has blood across the board and grime everywhere (fine detail 12.9 against our 10.5)
        ("Spatter", 9, 13, 7, None, 30, "board"), ("Spatter", -15, 17, 6, None, 200, "board"), ("Spatter", 15, -16, 8, None, 120, "board"),
        ("Smear", -27, 8, 10, None, 90, "board"),
        ("Dirt", 31.2, -8, 34, 6, 0, "table"),            # was (42, -8, 34): mostly beyond the far edge; now the far strip
        # (Dirt (38, 30, 30) dropped: no free table there now between the clipboard, the mug and the tape roll)
        ("Dirt", 2, -42.5, 22, None, 260, "table"), ("Dirt", -16, 47.6, 14, None, 80, "table"),  # were (-6, -50, 30), (-4, 52, 28)
        ("Ring", 29.8, 32.5, 9, None, 0, "table"), ("Ring", 28, -44, 8, None, 110, "table"),      # were (22, 30, 10), (44, -40, 9)
        # pass 62: knife scars and scuffs on the table round the board (judge run 4: wide flat brown areas; V2 detail)
        ("Scratch", -20, -41.8, 24, None, -10, "table"), ("Scratch", 4, -42, 22, None, 80, "table"),
        ("Scratch", 31.2, 14, 24, 6, 0, "table"),  # ((6, 46, 32) lies under the clipboard now: it drew "pencil" lines on its sheet)
        ("Scratch", -16, 42, 20, None, 60, "table"), ("Scratch", 23, -44.4, 16, None, 140, "table"),
        # pass 64: blood on the near frame and the table edge in front of it (judge run 4: nothing on the table edge)
        ("Spatter", -26.5, -8, 7, None, 250, "board"), ("Smear", -31.1, 3, 5, None, 15, "edge"),
        # C4: the reference's worn near table edge: Scratch strips on the 7.6 cm of table between the board's near frame
        # (x -27.65) and the table's edge (x -35.3), scars running along the edge, clear of the resting hands.
        # C8b (judge run 6 V5 #3/#4: a hard-edged red rectangle and fur-like streaks on the near edge's face): the five
        # overlapping strips (and the smear above) reached past the edge, so the downward projection smeared them down the
        # vertical face, and three of them stacked on one 15 cm stretch. Now four strips end to end, 4-4.4 cm wide, every
        # footprint >= 1 cm inside the edge (x >= -34.3), and "edge" decals reach only 0.6 cm below the top.
        ("Scratch", -31.1, -12, 18, 4.4, 2, "edge"), ("Scratch", -31.1, 10, 16, 4.0, 178, "edge"),
        ("Scratch", -31.1, -46, 14, 4.4, 180, "edge"), ("Scratch", -31.1, 46, 14, 4.4, 2, "edge")]
    # C8b: every table decal's footprint stays >= 1 cm inside the table's edges (x +-35.3, y +-56.7; the far and side
    # faces are what the Black seat and the side views see) and off the board frame's sides (|x|, |y| 27.65)
    for k, (v, x, y, wy, wz, yaw, level) in enumerate(placements):
        if v not in blood:
            continue
        zc, depth = (top + 2.0, 0.9) if level == "board" else (top + 0.45, 1.05) if level == "edge" else (top + 0.1, 1.4)
        dec = EAS.spawn_actor_from_class(unreal.DecalActor, unreal.Vector(x, y, zc), unreal.Rotator(0, -90, yaw))
        dec.decal.set_decal_material(blood[v])
        setp(dec.decal, "decal_size", unreal.Vector(depth, wy / 2, (wz or wy) / 2))
        setp(dec.decal, "sort_order", k)
        dec.set_folder_path("Wear")
    if "Drips" in blood and os.environ.get("TC_EDGE_DRIPS") == "1":  # off: it projected onto the player's forearm
        dec = EAS.spawn_actor_from_class(unreal.DecalActor, unreal.Vector(-48, -14, top - 6), unreal.Rotator(0, 0, 0))
        dec.decal.set_decal_material(blood["Drips"])
        setp(dec.decal, "decal_size", unreal.Vector(10, 16, 12))
        dec.set_folder_path("Wear")
    def prop_with(name, mats):
        """Import a Blender prop and map its OBJ material slots (usemtl names) to our material instances."""
        meshes = import_prop(name)
        for sm in meshes:
            for i, sl in enumerate(sm.static_materials):
                slot = str(sl.material_slot_name)
                mi = next((v for k, v in mats.items() if k.lower() in slot.lower()), None)
                if mi:
                    sm.set_material(i, mi)
            EAL.save_loaded_asset(sm)
        return meshes[0] if meshes else None

    # ---- Our own clutter (pass 51, props.py + forms.py): patient-record sheets, a book pile, a pill bottle
    papers = import_prop("loose_papers")
    for sm in papers:
        sm.set_material(0, mi_form)
        EAL.save_loaded_asset(sm)
    # pass 58 added two on the right; the nearer one (-14, 74) cut the frame's right border as a jagged white edge (judge run 4)
    # C4: all three hung off the table (x +-35.3, y +-56.7): (22, 66) floated beyond the right edge (C4-clipboard.jpg),
    # (40, -46) 10 cm past the far edge, (-36, -46) past the near edge. On the top they land in the lamp's pool: at
    # (-23, -44) / (21, -38) / (24, -45) they lifted the default view's mean by up to 2.2 and put it over V1's 30
    # (C4-board-env.json, C4a-C4c), so none is placed; the forms stock now shows on the clipboard's pad instead.
    PAPERS = []  # [((x, y), yaw), ...] on the top, each sheet ~13 cm from its centre to its farthest corner
    for loc, yaw in PAPERS:
        tag(place_model(papers, (loc[0], loc[1], 0), yaw=yaw, label="Papers", sit_on=top + 0.05)[0])
    cover = lambda n, c: make_mi(master, n, {"BaseColor": None}, tint=c, rough=0.82, grime_color=(0.12, 0.09, 0.06),
                                 scalars={"GrimeTiling": 4.0, "GrimeThreshold": 0.5, "GrimeContrast": 2.2, "MicroRough": 0.2})
    books = prop_with("book_stack", {"BookCoverA": cover("MI_BookOxblood", (0.16, 0.045, 0.035)),
                                     "BookCoverB": cover("MI_BookGreen", (0.045, 0.07, 0.045)),
                                     "BookCoverC": cover("MI_BookBrown", (0.12, 0.08, 0.05)),
                                     "Pages": make_mi(master, "MI_BookPages", {"BaseColor": None}, tint=(0.5, 0.45, 0.35), rough=0.92,
                                                      grime_color=(0.25, 0.2, 0.14), scalars={"GrimeTiling": 6.0, "GrimeThreshold": 0.45})})
    if books:
        # C4.1: on the cart's tray (it stood at (54, 50) at table height, beyond the table's far edge, the tray running
        # 3.6 cm into the bottom book); 28 x 21 cm, long side along y, inside the tray's lips, nearer the seat's side
        tag(place_model([books], (CART_TRAY[0] - 3.0, CART_TRAY[1] - 10.0, 0), yaw=-100, label="Books", sit_on=CART_TRAY[2] + 0.05)[0])
    pills = prop_with("pill_bottle", {"AmberBottle": make_mi(master, "MI_AmberBottle", {"BaseColor": None}, tint=(0.22, 0.08, 0.015), rough=0.3),
                                      "Label": make_mi(master, "MI_PillLabel", {"BaseColor": None}, tint=(0.55, 0.5, 0.4), rough=0.9,
                                                       grime_color=(0.3, 0.22, 0.15), scalars={"GrimeTiling": 8.0, "GrimeThreshold": 0.4}),
                                      "Cap": make_mi(master, "MI_PillCap", {"BaseColor": None}, tint=(0.55, 0.55, 0.52), rough=0.6),
                                      "Tablet": make_mi(master, "MI_Tablet", {"BaseColor": None}, tint=(0.62, 0.6, 0.55), rough=0.7)})
    if pills:
        # C4.1: (36, -24) put the bottle on the table's far edge (x 35.3); the spilled tablets lie up to 9 cm from it,
        # so it moves where they all land on the top: clear of the board frame (y -27.65), the captured pieces (~(29, -38)),
        # the lamp base (24, -56) and the bowl (-8, -46)
        tag(place_model([pills], (14, -42, 0), yaw=30, label="Pills", sit_on=top)[0])
    bowl = import_prop("brass_bowl")
    if bowl:
        for sm in bowl:
            sm.set_material(0, mi_brass_clutter := make_mi(master, "MI_BowlBrass", {"BaseColor": None, "ARM": METAL_ARM}, metal=1.0, rough=0.58, tint=(0.48, 0.35, 0.18),
                                                             grime_color=(0.25, 0.22, 0.18), scalars={"GrimeTiling": 3.0, "GrimeThreshold": 0.4, "GrimeContrast": 2.0, "MicroRough": 0.25}))
            EAL.save_loaded_asset(sm)
        tag(place_model(bowl, (-8, -46, 0), yaw=0, label="Bowl", sit_on=top)[0])
    mug = import_prop("tin_mug")
    tag(place_model(mug, (30, 38, 0), yaw=-120, label="Mug", sit_on=top)[0])
    for sm in mug:
        sm.set_material(0, mi_rust)
        EAL.save_loaded_asset(sm)
    # Table clutter after the reference (pass 48: its fine detail measured 12.9 against our 10.5): small worn objects at
    # the table's edges, each scaled to a maximum size so none can wall off the board (the book set once did).
    def clutter(name, loc, yaw, max_dim):
        try:
            meshes = import_model(name)
        except (StopIteration, FileNotFoundError):
            log("WARNING clutter model missing", name)
            return
        if not meshes:
            return
        lo, hi = bounds_of(meshes)
        size = max(hi[i] - lo[i] for i in range(3)) or 1.0
        place_model(meshes, (loc[0], loc[1], 0), yaw=yaw, scale=min(1.0, max_dim / size), label="Clutter_" + name, sit_on=top)
    # (the book set rendered as a thin floating strip and the magnifier stood upright with a bright lens: removed, pass 48)
    # C4: our own tape roll (props.py tape_roll) instead of Poly Haven medical_tape, which imported without its maps and,
    # scaled to 7 cm, read as a white puck (judge baseline V5 #7). Standing on its edge beyond the clipboard's far
    # corner, its axis ~40 deg off the line from the seat so the hole and the core read, the peeled tail stuck to the
    # table towards the player.
    tape = prop_with("tape_roll", {
        # (first try: grime threshold 0.35-0.42 streaked the roll brown like wood grain, C4a_tape)
        "TapeSide": make_mi(master, "MI_TapeSide", {"BaseColor": None}, tint=(0.46, 0.44, 0.39), rough=0.85, grime_color=(0.32, 0.27, 0.2),
                            scalars={"GrimeTiling": 9.0, "GrimeThreshold": 0.5, "GrimeContrast": 2.0, "GrimeStreaks": 0.0, "MicroRough": 0.2}),
        "TapeCore": make_mi(master, "MI_TapeCore", {"BaseColor": None}, tint=(0.26, 0.18, 0.1), rough=0.9, grime_color=(0.15, 0.1, 0.06),
                            scalars={"GrimeTiling": 8.0, "GrimeThreshold": 0.5, "GrimeContrast": 2.0}),
        "Tape": make_mi(master, "MI_TapeRoll", {"BaseColor": None}, tint=(0.6, 0.58, 0.52), rough=0.8, grime_color=(0.42, 0.37, 0.29),
                        scalars={"GrimeTiling": 6.0, "GrimeThreshold": 0.62, "GrimeContrast": 2.0, "GrimeStreaks": 0.0, "MicroRough": 0.2, **FLAT_DETAIL})})
    if tape:
        place_model([tape], (28, 50, 0), yaw=60, label="TapeRoll", sit_on=top)
    clutter("cigarette_pack", (-24, -36), 35, 9.0)            # by the bowl, near the player's left hand
    beds = import_model("old_bed_frame")
    if beds:
        # the FBX importer's material rendered base colour 255 white (materials audit): the scan's own maps on the
        # layered master instead. The scan is warm rusty paint (mean sRGB 114/99/90); the white beds were the frame's
        # main cool/neutral area, and with the scan at a warm tint the C2.3 main view went to r/g 1.51, g/b 1.72 (V1
        # out; at x1.0-1.4 still 1.50/1.71). Tinted to a pale grey-green institutional paint over the rust instead
        # (scan x 2.4/2.7/3.2: painted areas ~0.45 linear, the rusty patches stay dark)
        # C4 (judge V5 #9, "glowing" springs): the scan's pale paint is sRGB ~164/157/145, so x 2.4/2.7/3.2 made it a
        # ~0.9 albedo blue-white that the 7500 K Window_Cold rect right behind bed A turned into a lit wire grid; a duller
        # grey-green paint instead (TC_BED_TINT to tune)
        bed_tint = tuple(float(v) for v in os.environ.get("TC_BED_TINT", "1.5,1.75,2.6").split(","))
        assign(beds, model_material(master, "old_bed_frame", "old_bed_frame", "MI_OldBedFrame", tint=bed_tint, grime_color=(0.45, 0.4, 0.36),
                                    scalars={"GrimeTiling": 2.0, "GrimeThreshold": 0.4, "GrimeContrast": 2.0, "GrimeStreaks": 0.5, "MicroRough": 0.15}))
        place_model(beds, (cx + L / 2 - 55, -120, 0), yaw=90, label="BedA", sit_on=0.0)
        place_model(beds, (cx + L / 2 - 55, 125, 0), yaw=90, label="BedB", sit_on=0.0)
    # barred window on the back wall, behind the opponent's right shoulder: cold glow + iron frame, mullion and bars
    # (the Window_Cold rect light sits in it, lighting block). C9 (rendering architect, lead-authorised move; judge run 6
    # gaps 1/5 "no cold back light", "no window/cold source in frame"): the window was at y -150, z 140-230, above the
    # top of the seat view (it meets the back wall at z ~140-150) and behind the lamp head. Now a narrow upright window
    # like the reference's, between the lamp head and the opponent's head (seat view x ~0.34-0.40, top ~0.03-0.23 of
    # the frame), on the wainscot's face (x 317, the wainscot runs to z 140). TC_WINDOW=y,z,width,height (centre, cm).
    WIN = [float(v) for v in os.environ.get("TC_WINDOW", "-63,110,26,56").split(",")]
    wf = cx + L / 2 - 3  # the wainscot's face
    glow = emissive_material("M_TC_WindowGlow", (0.55, 0.7, 0.8), float(os.environ.get("TC_WINDOW_GLOW", 30.0)))
    box("Window_Glow", (wf - 0.5, WIN[0], WIN[1]), (1, WIN[2], WIN[3]), glow, folder="Window")
    fr = 4.0  # frame width
    for nm, loc, size in (("Window_FrameTop", (wf - 2, WIN[0], WIN[1] + WIN[3] / 2 + fr / 2), (4, WIN[2] + 2 * fr, fr)),
                          ("Window_FrameSill", (wf - 3, WIN[0], WIN[1] - WIN[3] / 2 - fr / 2), (6, WIN[2] + 2 * fr + 4, fr)),
                          ("Window_FrameL", (wf - 2, WIN[0] - WIN[2] / 2 - fr / 2, WIN[1]), (4, fr, WIN[3])),
                          ("Window_FrameR", (wf - 2, WIN[0] + WIN[2] / 2 + fr / 2, WIN[1]), (4, fr, WIN[3])),
                          ("Window_Mullion", (wf - 1.75, WIN[0], WIN[1] + WIN[3] * 0.12), (1.5, WIN[2], 2.5))):
        box(nm, loc, size, mi_bar, folder="Window")
    cyl = unreal.load_asset("/Engine/BasicShapes/Cylinder")
    for k in (-1, 0, 1):  # three bars in front of the panes; they also shape the cold light's shafts in the haze
        b = EAS.spawn_actor_from_object(cyl, unreal.Vector(wf - 4, WIN[0] + k * WIN[2] / 4, WIN[1]), unreal.Rotator(0, 0, 0))
        b.set_actor_scale3d(unreal.Vector(0.018, 0.018, WIN[3] / 100))
        b.static_mesh_component.set_material(0, mi_bar)
        b.set_folder_path("Window")
    # (the white binder was the brightest thing in frame and pulled the eye off the board: removed)
    # barred partition behind the opponent (the reference's cell bars) and a stencilled ward sign on the back wall
    cyl = unreal.load_asset("/Engine/BasicShapes/Cylinder")
    bx = cx + L / 2 - 75
    for k in range(-9, 10):
        if abs(k) < 2:
            continue  # the gap of an open door behind him
        b = EAS.spawn_actor_from_object(cyl, unreal.Vector(bx, k * 13.0, 115), unreal.Rotator(0, 0, 0))
        b.set_actor_scale3d(unreal.Vector(0.03, 0.03, 2.3))
        b.static_mesh_component.set_material(0, mi_bar)
        b.set_folder_path("Bars")
    for z in (12, 222):
        rail = EAS.spawn_actor_from_object(unreal.load_asset("/Engine/BasicShapes/Cube"), unreal.Vector(bx, 0, z), unreal.Rotator(0, 0, 0))
        rail.set_actor_scale3d(unreal.Vector(0.05, 2.5, 0.06))
        rail.static_mesh_component.set_material(0, mi_bar)
        rail.set_folder_path("Bars")
    # C8b (judge run 6 gap 5, environment row): the reference's painted "WARD B" sign with its arrow, on the wall at the
    # opponent's right shoulder. The old TextRenderActor (flat engine font at z 205) sat above the top of the frame (the
    # seat view meets the back wall at z ~150). Now a decal of our own stencil texture (ue5/tools/textures/ward_sign.py,
    # Courier Prime OFL) painted onto the back wall's tiles and plaster, lit by BackWall_Wash and Corridor_Glow.
    sign_png = os.path.join(TEXTURES_DIR, "signs", "T_WardSign_BaseColor.png")
    if os.path.exists(sign_png):
        sy, sz, ssize, syaw = (float(v) for v in os.environ.get("TC_SIGN", "62,110,56,90").split(","))
        stex = import_texture(sign_png, f"{ROOT}/Textures/Signs", "T_WardSign_BaseColor", "color")
        path = f"{ROOT}/Materials/M_TC_WardSign"
        if EAL.does_asset_exist(path):
            EAL.delete_asset(path)
        sm_ = AT.create_asset("M_TC_WardSign", f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew())
        sm_.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)  # blend mode before the domain (C6 lesson)
        sm_.set_editor_property("material_domain", unreal.MaterialDomain.MD_DEFERRED_DECAL)
        st = MEL.create_material_expression(sm_, unreal.MaterialExpressionTextureSample, -500, 0)
        st.set_editor_property("texture", stex)
        MEL.connect_material_property(st, "RGB", unreal.MaterialProperty.MP_BASE_COLOR)
        MEL.connect_material_property(st, "A", unreal.MaterialProperty.MP_OPACITY)
        sr = MEL.create_material_expression(sm_, unreal.MaterialExpressionConstant, -300, 200)
        sr.set_editor_property("r", 0.8)  # matte paint over the tiles' glaze
        MEL.connect_material_property(sr, "", unreal.MaterialProperty.MP_ROUGHNESS)
        MEL.recompile_material(sm_)
        EAL.save_loaded_asset(sm_)
        sign = EAS.spawn_actor_from_class(unreal.DecalActor, unreal.Vector(cx + L / 2 - 2, sy, sz), unreal.Rotator(syaw, 0, 0))  # roll 90: upright, the text runs along +Y
        sign.decal.set_decal_material(sm_)
        setp(sign.decal, "decal_size", unreal.Vector(4.0, ssize / 2, ssize / 2))  # x: 4 cm either side of the wall's face
        sign.set_actor_label("WardSign")
        sign.set_folder_path("Room")
    else:
        log("WARNING ward sign texture missing", sign_png)
    chair = import_model("painted_wooden_chair_01")
    tag(place_model(chair, (92, 0, 0), yaw=180, label="OpponentChair", sit_on=0.0)[0])
    cabinet = import_model("drawer_cabinet")
    # C8b (judge run 6 V5 #5, "a stretched, streaky lit panel behind the lamp"): at yaw 180 the cabinet's drawer front
    # faced the wall and the seat saw its back, one flat board whose UVs stretch the scan's grain over ~1 m, lit by
    # Window_Cold 30 cm away (C8b-panel.jpg). Turned round, the drawer front faces the room.
    place_model(cabinet, (cx + L / 2 - 40, -140, 0), yaw=float(os.environ.get("TC_CABINET_YAW", 0.0)), label="Cabinet", sit_on=0.0)
    wheel = import_model("wheelchair_01")
    if wheel:  # same importer-material problem as the beds (white frame in the base-colour buffer)
        assign(wheel, model_material(master, "wheelchair_01", "wheelchair_01", "MI_Wheelchair", tint=(0.7, 0.68, 0.64), grime_color=(0.38, 0.3, 0.22),
                                     scalars={"GrimeTiling": 2.0, "GrimeThreshold": 0.45, "GrimeContrast": 2.0, "MicroRough": 0.15}))
    place_model(wheel, (cx + L / 2 - 70, 150, 0), yaw=-140, label="Wheelchair", sit_on=0.0)
    desk = import_model("metal_office_desk")
    _, dlo, dhi = place_model(desk, (cx - 40, W / 2 - 45, 0), yaw=90, label="Desk", sit_on=0.0)
    books = import_model("book_encyclopedia_set_01")
    place_model(books, (cx - 40, W / 2 - 45, 0), yaw=90, label="Books", sit_on=dhi[2] - dlo[2])
    pipes = import_model("modular_industrial_pipes_01")
    place_model(pipes, (cx + L / 2 - 15, 0, H - 40), yaw=90, label="Pipes")
    fluo = import_model("mounted_fluorescent_lights")
    place_model(fluo, (cx + 120, 60, H - 2), yaw=0, label="Fluorescent")

    # ---- Opponent (template mannequin as a stand-in until MetaHuman): seated across the table, facing the player.
    manny = unreal.load_asset("/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple")
    idle = unreal.load_asset("/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle")
    # ---- Opponent roster (docs/CHARACTERS.md). Every character is built into the level at the same seat, tagged
    # TC_Opponent_<id>; ATCGameMode shows the selected one (-tcopponent=<id>, default "caged") and hides the rest.
    # MetaHumans come from ue5/TownChess/Scripts/mh_opponent.py; the template mannequin stands in where none is built.
    R = unreal.AttachmentRule
    seated_cache = {}

    def attach_static(name, mesh, parent_smc, bone, loc, rot, opp_tag):
        a = EAS.spawn_actor_from_object(mesh, unreal.Vector(90, 0, 120), unreal.Rotator(0, 0, 0))
        a.set_actor_label(name)
        a.static_mesh_component.set_mobility(unreal.ComponentMobility.MOVABLE)  # a Static actor cannot attach to the animated body
        try:
            a.attach_to_component(parent_smc, bone, R.SNAP_TO_TARGET, R.SNAP_TO_TARGET, R.KEEP_WORLD, False)
        except TypeError as e:
            log("WARNING attach failed:", name, e)
        a.root_component.set_relative_location(loc, False, False)
        a.root_component.set_relative_rotation(rot, False, False)
        tag(a); tag(a, opp_tag)
        return a


    def spawn_opponent(opp_id, mhn, outfit_mi=None, pose="rest", loc=(90.0, 0.0, 0.0), yaw=90.0, with_face=True, group_tag=None):
        """Body (seated pose), face and outfit as skeletal mesh actors; the game links face/outfit to the body."""
        opp_tag = group_tag or f"TC_Opponent_{opp_id}"
        mh_body = unreal.load_asset(f"{MH_ROOT}/{mhn}/Body/SKM_{mhn}_BodyMesh") if GAMEPLAY and mhn else None
        body_mesh = mh_body or manny
        if not (idle and body_mesh):
            log("WARNING: no body for", opp_id)
            return None, None
        key = body_mesh.get_path_name() + pose
        if key not in seated_cache:
            try:
                seated_cache[key] = (build_seated_pose(body_mesh, idle, f"{ROOT}/Anims", f"A_TC_Seated_{body_mesh.get_name()}_{pose}",
                                                       own_proportions=bool(mh_body), pose_name=pose), dict(SEATED))
            except Exception:
                log("WARNING seated pose failed\n" + traceback.format_exc())
                seated_cache[key] = (None, dict(SEATED))
        seated, head = seated_cache[key]
        SEATED.update(head)
        opp = EAS.spawn_actor_from_object(body_mesh, unreal.Vector(*loc), unreal.Rotator(0, 0, yaw))  # mesh faces +Y; yaw 90 -> -X
        opp.set_actor_label(f"Opponent_{opp_id}")
        smc = opp.skeletal_mesh_component
        setp(smc, "receives_decals", False)  # table blood/stains must never land on hands or forearms
        tag(opp); tag(opp, opp_tag); tag(opp, "TC_Body")
        setp(smc, "animation_mode", unreal.AnimationMode.ANIMATION_SINGLE_NODE)
        data = unreal.SingleAnimationPlayData()
        setp(data, "anim_to_play", seated or idle)
        setp(data, "saved_looping", True)
        setp(data, "saved_playing", True)
        setp(smc, "animation_data", data)
        if mh_body:
            followers = []
            face = unreal.load_asset(f"{MH_ROOT}/{mhn}/Face/SKM_{mhn}_FaceMesh") if with_face else None
            if face:
                followers.append(("Face", face, None))
            # outfit meshes: the body hides the skin under them, so they must be present or the torso renders as a hole
            for p in EAL.list_assets(f"{MH_ROOT}/{mhn}/Clothing", recursive=False):
                cm = unreal.load_asset(p)
                if isinstance(cm, unreal.SkeletalMesh):
                    followers.append((cm.get_name(), cm, outfit_mi))
            for label, mesh, mi in followers:
                f = EAS.spawn_actor_from_object(mesh, unreal.Vector(*loc), unreal.Rotator(0, 0, yaw))
                f.set_actor_label(f"Opponent_{opp_id}_{label}")
                f.skeletal_mesh_component.set_mobility(unreal.ComponentMobility.MOVABLE)
                setp(f.skeletal_mesh_component, "receives_decals", False)
                f.attach_to_actor(opp, "", R.KEEP_WORLD, R.KEEP_WORLD, R.KEEP_WORLD, False)
                if mi:
                    for i in range(f.skeletal_mesh_component.get_num_materials()):
                        f.skeletal_mesh_component.set_material(i, outfit_slot_material(mi, f.skeletal_mesh_component.get_material(i)))
                tag(f); tag(f, opp_tag); tag(f, "TC_FollowBody")
        else:
            for i in range(smc.get_num_materials()):
                smc.set_material(i, mi_cloth)
        log("opponent", opp_id, "body", body_mesh.get_name())
        return opp, smc

    mhn = os.environ.get("TC_MH_NAME", "MH_Walter")
    # the cinematic build (full skin shader, top LODs, strand grooms) when it exists, else the optimized one
    MH_ROOT = "/Game/TownChess/MetaHumans/BuiltCine" if EAL.does_asset_exist(f"/Game/TownChess/MetaHumans/BuiltCine/{mhn}/Body/SKM_{mhn}_BodyMesh") \
        else "/Game/TownChess/MetaHumans/Built"
    log("metahuman build", MH_ROOT)
    if not EAL.does_asset_exist(f"{MH_ROOT}/{mhn}/BP_{mhn}"):
        mhn = "MH_Opponent" if EAL.does_asset_exist("/Game/TownChess/MetaHumans/Built/MH_Opponent/BP_MH_Opponent") else None

    # 1. The caged patient: Blender cage mask over the face, stained off-white shirt
    mi_gown_early = make_mi(master, "MI_PatientShirt", {"BaseColor": None}, tint=(0.42, 0.4, 0.34), rough=0.9, grime_color=(0.45, 0.36, 0.24),
                            scalars={"GrimeTiling": 1.6, "GrimeThreshold": 0.32, "GrimeContrast": 1.8, "GrimeStreaks": 0.6})
    opp, smc = spawn_opponent("caged", mhn, outfit_mi=mi_gown_early, pose=os.environ.get("TC_CAGED_POSE", "clasp"))
    skins = player_skins(mhn) if (mhn and GAMEPLAY) else {}
    if smc and "dirty" in skins:  # the reference's patient has grimy hands too (and the clean tan ones caught the lamp)
        smc.set_material(0, skins["dirty"])
    if smc and "head" in SEATED:
        cage = import_prop("cage_mask")
        if cage:
            # dark forged iron, rust in patches (not an even orange coat)
            # plain dark iron (the rust scan's orange overpowered any tint: oversight run 1); rust only in grime patches
            # blackened iron behaves like a dark dielectric with neutral highlights: at metal 0.85 the wire mirrored the warm
            # lamp and the brown room and rendered bronze-tan although its base colour was dark grey; at 0.028/metal 0.3 the
            # lamp just above still lit it mid-brown (base colour 47 sRGB, final 97,56,30): near-black, rougher (pass 42)
            mi_iron = make_mi(master, "MI_CageIron", {"BaseColor": None}, metal=0.0, rough=0.68, tint=(0.012, 0.0115, 0.011),
                              grime_color=(0.42, 0.2, 0.09), scalars={"GrimeTiling": 4.0, "GrimeThreshold": 0.7, "GrimeContrast": 3.0,
                                                                     "GrimeRoughness": 0.85, "MicroRough": 0.25})
            cage[0].set_material(0, mi_iron)
            EAL.save_loaded_asset(cage[0])
            off = [float(v) for v in os.environ.get("TC_MASK_OFFSET", "0,4.5,-1").split(",")]  # forward (+Y), up (+Z) from the head bone
            attach_static("CageMask", cage[0], smc, "head", *head_relative(off), "TC_Opponent_caged")
        # straitjacket: canvas webbing belts round the chest and waist with brass buckles (props.py "restraint_straps")
        straps = import_prop("restraint_straps")
        if straps and "spine_03" in SEATED:
            mi_web = make_mi(master, "MI_Webbing", {"BaseColor": None}, tint=(0.34, 0.3, 0.22), rough=0.9, grime_color=(0.4, 0.32, 0.22),
                             scalars={"GrimeTiling": 3.0, "GrimeThreshold": 0.35, "GrimeContrast": 2.0, "MicroRough": 0.1})
            # rough dark iron (the bright brass roller buckle read as a chest logo: judge run 4)
            mi_buckle = make_mi(master, "MI_Buckle", {"BaseColor": None, "ARM": METAL_ARM}, metal=1.0, rough=1.3, tint=(0.09, 0.08, 0.07),
                                grime_color=(1.6, 1.0, 0.6), scalars={"GrimeTiling": 6.0, "GrimeThreshold": 0.55, "GrimeContrast": 2.0})
            for sm in straps:
                for i, sl in enumerate(sm.static_materials):
                    sm.set_material(i, mi_buckle if "buckle" in str(sl.material_slot_name).lower() else mi_web)
                EAL.save_loaded_asset(sm)
            # measured: the belt landed at z 58 (under the table); the chest is ~32 cm higher on the animated skeleton
            attach_static("Straitjacket", straps[0], smc, "spine_03", *bone_relative("spine_03", [0.0, 2.0, 26.0]), "TC_Opponent_caged")

    # 0. The player's own arms (first person): the reference shows real hands with sleeves resting on the board,
    #    not floating gloves. Eyes at the camera (x=-87, z=top+42); ATCGameMode hides the head (tag TC_PlayerBody).
    if mhn and GAMEPLAY and os.environ.get("TC_PLAYER_BODY", "1") == "1":
        SEAT.update(top=top, eye=(SEAT_EYE_X, 0.0, top + SEAT_EYE_DZ))  # the default-view eye (camera block below)
        probe = unreal.load_asset(f"{MH_ROOT}/{mhn}/Body/SKM_{mhn}_BodyMesh")
        build_seated_pose(probe, idle, f"{ROOT}/Anims", "A_TC_Probe_player", own_proportions=True, pose_name="player")
        hx, hy, hz = SEATED["head"][0]
        # component +Y (forward) -> world +X with yaw -90; eyes PLAYER_EYE_AHEAD cm before and 8 cm over the head bone; lowered by the
        # measured runtime offset (PLAYER_Z_FIX) so the solver's table-space hand targets hold in the game
        ex, _, ez = SEAT["eye"]
        zfix = PLAYER_Z_FIX if (SEATED.get("player:calibrated") is not True or "TC_PLAYER_ZFIX" in os.environ) else 0.0
        ploc = (ex - (hy + PLAYER_EYE_AHEAD), hx, ez - (hz + 8.0) - zfix)
        pb, _ = spawn_opponent("player", mhn, outfit_mi=mi_gown_early, pose="player", loc=ploc, yaw=-90.0, with_face=False,
                               group_tag="TC_PlayerBody")
        if pb:
            log("player body at", [round(v, 1) for v in ploc])
            want = os.environ.get("TC_PLAYER_SKIN", "bare")
            if want in skins:
                pb.skeletal_mesh_component.set_material(0, skins[want])
                log("player skin", want)
            SEATED["player_body"] = True  # the XR stand-in gloves give way to real arms
            # off by default: bisected as the cause of a 2x exposure jump (mean 39 -> 85) and visually weak; the real
            # fix for hand veins is MetaHuman 8K skin (owner action). TC_HAND_DECALS=1 brings them back for testing.
            hd = hand_decal_materials() if os.environ.get("TC_HAND_DECALS", "0") == "1" else None
            hands = SEATED.get("player_hands")
            if hd and hands:
                # C5: these were spawned with unreal.Rotator(-90, yaw, 0) = (roll, pitch, yaw) in UE Python, i.e. roll -90
                # and the yaw as a pitch: they projected sideways (the C4 finding for the table decals). Now pitch -90
                # (straight down) with the forearm's yaw; decal_size is a half extent (depth, across, along the hand). The
                # box was also centred 8 cm over the wrist bone, above the hand, so it reached no skin; it now spans the
                # back of the hand (~2.5 cm over the wrist bone at the knuckles' side). And spawn_opponent sets
                # receives_decals False on every body (table blood must not land on the arms), so with decals on the
                # player's body has to receive them.
                setp(pb.skeletal_mesh_component, "receives_decals", True)
                for side, (hand, elbow) in hands.items():
                    # component -> world for yaw -90: (x, y) -> (y, -x); the back of the hand is ~5 cm past the wrist
                    w = (ploc[0] + hand[1], ploc[1] - hand[0], ploc[2] + hand[2])
                    e = (ploc[0] + elbow[1], ploc[1] - elbow[0], ploc[2] + elbow[2])
                    fx, fy = w[0] - e[0], w[1] - e[1]
                    L = max(math.hypot(fx, fy), 1e-3)
                    c = (w[0] + fx / L * 5.0, w[1] + fy / L * 5.0, w[2] + 2.5)
                    yaw = math.degrees(math.atan2(fy, fx))
                    for mat in ("M_TC_HandDirt", "M_TC_HandVeins"):
                        dec = EAS.spawn_actor_from_class(unreal.DecalActor, unreal.Vector(*c), unreal.Rotator(0, -90, yaw))
                        dec.decal.set_decal_material(hd[mat])
                        setp(dec.decal, "decal_size", unreal.Vector(2.0, 4.0, 4.5))  # shallow: the back of the hand, not the palm or the table
                        dec.set_actor_label(f"HandDetail_{side}_{mat[5:]}")
                        dec.set_folder_path("Player")
                log("hand detail decals on", sorted(hands))

        # Player hand options (the reference's HAND CUSTOMIZATION): institutional sleeves and a wristwatch, attached to
        # the player's forearms and shown by ATCGameMode::ApplyPlayerLook (tags TC_PlayerOpt_<option>)
        hands = SEATED.get("player_hands")
        if pb and hands and "player:lowerarm_l" in SEATED:
            psmc = pb.skeletal_mesh_component
            # C6: woven canvas (rough_linen, a blue scan: tint 1.06/0.71/0.51 on its linear mean 0.28/0.42/0.61 gives a pale
            # grey canvas ~0.30/0.30/0.31, the reference's "Institutional Sleeves"; was a flat 0.11/0.12/0.13 grey-green. A
            # beige 1.27/0.76/0.41 put the Black seat at g/b 1.702 from the two bottom corners: V1 <= 1.70), square weave
            # on the C5 cylindrical UVs (31.4 cm round x 20 cm along: UVScale V 0.64), ~12 threads/cm; cuff/fold grime and
            # stains from textures/sleeve.py through the UV-space WearMask
            wear = os.path.join(TEXTURES_DIR, "sleeve", "T_PlayerSleeve_Wear.png")
            mi_ps = surface_material(master, "rough_linen", name="MI_PlayerSleeve", tiling=0.8, tint=(1.06, 0.71, 0.51), rough=1.0,
                                     grime_color=(0.32, 0.27, 0.21),
                                     scalars={"GrimeTiling": 1.3, "GrimeThreshold": 0.5, "GrimeContrast": 1.8, "GrimeStreaks": 0.35,
                                              "GrimeRoughness": 0.95, "NormalStrength": 1.5, "MicroRough": 0.1})
            MEL.set_material_instance_vector_parameter_value(mi_ps, "UVScale", unreal.LinearColor(1.0, 20.0 / 31.4, 1.0, 1.0))
            MEL.set_material_instance_vector_parameter_value(mi_ps, "StainColor", unreal.LinearColor(0.5, 0.3, 0.24, 1.0))
            if os.path.exists(wear):
                MEL.set_material_instance_texture_parameter_value(mi_ps, "WearMask", import_texture(wear, f"{ROOT}/Textures/Sleeve", "T_PlayerSleeve_Wear", "linear"))
            MEL.update_material_instance(mi_ps)
            EAL.save_loaded_asset(mi_ps)
            sleeve_sm = prop_with("player_sleeve", {"PlayerSleeve": mi_ps})
            watch_sm = prop_with("wristwatch", {"Strap": make_mi(master, "MI_WatchStrap", {"BaseColor": None}, tint=(0.07, 0.045, 0.03), rough=0.7),
                                                "Steel": make_mi(master, "MI_WatchSteel", {"BaseColor": None, "ARM": METAL_ARM}, metal=1.0, rough=0.35, tint=(0.55, 0.55, 0.53)),
                                                "Dial": make_mi(master, "MI_WatchDial", {"BaseColor": import_texture(os.path.join(TEXTURES_DIR, "watch", "T_WatchDial_BaseColor.png"),
                                                                                                      f"{ROOT}/Textures/Watch", "T_WatchDial_BaseColor", "color")
                                                                                       if os.path.exists(os.path.join(TEXTURES_DIR, "watch", "T_WatchDial_BaseColor.png")) else None},
                                                               tint=(0.55, 0.52, 0.46), rough=0.35)})  # printed dial (textures/watch.py), pass 60
            for side, (hand, elbow) in hands.items():
                d = tuple(hand[i] - elbow[i] for i in range(3))
                n = math.sqrt(sum(c * c for c in d)) or 1.0
                if sleeve_sm:
                    loc, rot = aimed_on_bone(f"player:lowerarm_{side}", elbow, d)
                    attach_static(f"PlayerSleeve_{side}", sleeve_sm, psmc, f"lowerarm_{side}", loc, rot, "TC_PlayerOpt_sleeves")
                if watch_sm and side == "l":
                    # 4 cm up the forearm from the wrist joint. Pass 60 asked for 2.5, but the solver's short forearm put it ~5.4 cm up
                    # at runtime, where the strap fits; at a true 2.5 cm (C5 calibrated model) the oval strap hung under the wrist
                    wrist = tuple(hand[i] - d[i] / n * 4.0 for i in range(3))  # the sleeve (20 cm from the elbow) ends ~6 cm up
                    loc, rot = aimed_on_bone(f"player:lowerarm_{side}", wrist, d)
                    attach_static("PlayerWatch", watch_sm, psmc, f"lowerarm_{side}", loc, rot, "TC_PlayerOpt_watch")
            log("player hand options attached", sorted(hands))

    # 2. The Annotator: slate-green coat, tan oversleeves, linen coif, two-leaf riveted plate, ledger and pencil
    # flat cloth colours (the linen scan's yellow cast turned slate green into lime) + our grime layer for wear
    cloth = {"GrimeTiling": 2.0, "GrimeThreshold": 0.5, "GrimeContrast": 2.0, "MicroRough": 0.1}
    mi_coat = make_mi(master, "MI_AnnotatorCoat", {"BaseColor": None}, tint=(0.05, 0.07, 0.06), rough=0.85, scalars=cloth)   # ~#3E4A43 in sRGB
    mi_duck = make_mi(master, "MI_Oversleeve", {"BaseColor": None}, tint=(0.36, 0.27, 0.16), rough=0.9, grime_color=(0.35, 0.33, 0.32), scalars=cloth)
    mi_coif = make_mi(master, "MI_Coif", {"BaseColor": None}, tint=(0.22, 0.2, 0.17), rough=0.95, scalars=cloth)

    # hand-formed steel with light patina (the spec's mask is maintained, not rusted through): plain metal + grime layer
    mi_steel = make_mi(master, "MI_MaskSteel", {"BaseColor": None}, metal=1.0, rough=0.66, tint=(0.1, 0.098, 0.095),  # worked steel: dark and rough enough not to mirror the lamp
                       grime_color=(0.45, 0.38, 0.3), scalars={"GrimeTiling": 4.0, "GrimeThreshold": 0.55, "GrimeContrast": 2.5,
                                                               "MicroRough": 0.25, "GrimeRoughness": 0.7})
    mi_copper = surface_material(master, "rusty_metal_02", name="MI_Copper", tiling=3.0, metal=1.0, tint=(0.95, 0.5, 0.32), rough=0.45)
    mi_black = make_mi(master, "MI_Pupil", {"BaseColor": None}, tint=(0.01, 0.01, 0.01), rough=0.9)
    mi_oxblood = surface_material(master, "brown_leather", name="MI_LedgerCloth", tiling=3.0, tint=(0.36, 0.09, 0.08), rough=0.85)
    mi_pages = make_mi(master, "MI_Pages", {"BaseColor": None}, tint=(0.78, 0.72, 0.6), rough=0.95)
    opp_a, smc_a = spawn_opponent("annotator", mhn, outfit_mi=mi_coat, pose="clasp")  # forearms on the table: the clerk at his desk
    if smc_a and "head" in SEATED:
        plate = prop_with("annotator_mask", {"Steel": mi_steel, "Copper": mi_steel, "Pupil": mi_black})  # steel rivets (copper read pink)
        coif = prop_with("annotator_coif", {"Linen": mi_coif})
        noff = [float(v) for v in os.environ.get("TC_NASION_OFFSET", "0,9.5,7").split(",")]  # head bone -> nasion
        if coif:
            attach_static("AnnotatorCoif", coif, smc_a, "head", *head_relative(noff), "TC_Opponent_annotator")
        if plate:
            attach_static("AnnotatorMask", plate, smc_a, "head", *head_relative([noff[0], noff[1] + 1.2, noff[2]]), "TC_Opponent_annotator")
        over = prop_with("oversleeve", {"Duck": mi_duck})
        coat = prop_with("coat_sleeve", {"Wool": mi_coat})
        def arm_sleeves(body, prefix, opp_tag, mi=None):
            """Sleeves aimed along the clasp pose's real arm joints (pass 61: the bone-axis guess with a roll flip left
            both characters' arms bare and stood one coat sleeve up beside the head). Forearm sleeve from 2 cm above
            the elbow, its gathered cuff ~3 cm short of the wrist; upper sleeve from 3 cm below the shoulder joint."""
            hands = SEATED.get("clasp_hands")
            if not (body and hands and "clasp:upperarm_l" in SEATED):
                return
            for side in ("l", "r"):
                hand, elbow = hands[side]
                sh = SEATED[f"clasp:upperarm_{side}"][0]
                for nm, mesh, bone, a0, a1, back in (("Sleeve", over, "lowerarm", elbow, hand, 2.0), ("UpperSleeve", coat, "upperarm", sh, elbow, -3.0)):
                    if not mesh:
                        continue
                    d = tuple(a1[k] - a0[k] for k in range(3))
                    n = math.sqrt(sum(c * c for c in d)) or 1.0
                    start = tuple(a0[k] - d[k] / n * back for k in range(3))
                    loc, rot = aimed_on_bone(f"clasp:{bone}_{side}", start, d)
                    act = attach_static(f"{prefix}{nm}_{side}", mesh, body, f"{bone}_{side}", loc, rot, opp_tag)
                    if mi:
                        for k in range(act.static_mesh_component.get_num_materials()):
                            act.static_mesh_component.set_material(k, mi)

        arm_sleeves(smc_a, "Annotator", "TC_Opponent_annotator")
        # the caged patient wears the same sleeve meshes as a long canvas jacket with stained cuffs over his short-sleeved
        # shirt (judge run 4: clothing 4/10; the reference's jacket is long-sleeved and filthy); material per actor, the
        # meshes stay the Annotator's (prop_with re-imports delete older meshes)
        if smc:
            mi_jacket = surface_material(master, "rough_linen", name="MI_PatientJacket", tiling=5.0, tint=(0.46, 0.26, 0.13), rough=0.95,
                                         grime_color=(0.32, 0.17, 0.1), scalars={"GrimeTiling": 1.4, "GrimeThreshold": 0.3, "GrimeContrast": 1.8,
                                                                                    "GrimeStreaks": 0.7, "MicroRough": 0.1})
            arm_sleeves(smc, "Patient", "TC_Opponent_caged", mi_jacket)
        led = prop_with("ledger", {"LedgerCloth": mi_oxblood, "Pages": mi_pages, "Ribbon": mi_oxblood})
        pen = prop_with("pencil", {"PencilPaint": mi_coat, "PencilWood": mi_pages, "Ferrule": mi_copper, "Eraser": mi_oxblood})
        for nm, mesh, loc, yaw in (("Ledger", led, (52, -34), 75), ("Pencil", pen, (46, -20), 30)):
            if mesh:
                a = EAS.spawn_actor_from_object(mesh, unreal.Vector(loc[0], loc[1], top + 0.1), unreal.Rotator(0, 0, yaw))
                a.set_actor_label(f"Annotator{nm}")
                tag(a); tag(a, "TC_Opponent_annotator")

    # ---- Player hands (XR mannequin hands as stand-ins), resting near the near board edge.
    for side, y, yaw_h in (() if SEATED.get("player_body") else (("left", -26, 0), ("right", 26, 0))):
        hm = unreal.load_asset(f"/Game/XRMannequins/Meshes/SKM_MannyXR_{side}")
        if hm:
            b = hm.get_bounds()
            log("hand", side, "bounds origin", b.origin, "extent", b.box_extent)
            # Fingers point along +Y in mesh space; yaw -90 points them at the board (+X).
            h = EAS.spawn_actor_from_object(hm, unreal.Vector(-26, y * 1.3, top + 5), unreal.Rotator(0, 0, -90))
            for i in range(h.skeletal_mesh_component.get_num_materials()):
                h.skeletal_mesh_component.set_material(i, mi_leather)
            h.set_actor_label(f"Hand_{side}")
            tag(h)
            h.set_folder_path("Player")
        else:
            log("WARNING: XR hand not found", side)

    # ---- Lighting: warm practical lamp (key), cool fluorescent fill, cool rim.
    lamp_head = (lamp_bulb[0], lamp_bulb[1], lamp_bulb[2] - 3)  # just under the bulb, inside the shade
    # cone 65 -> 52: a pool on the board (pass 61); C2: aimed at the board centre (was 10 cm beyond it), 450 -> 520 lm
    tag(spot("Lamp_Key", lamp_head, look_at_rot(lamp_head, (0, -4, top)), 520, 2800, 600, 56, src=2.5, vol=1.2))
    bulb = point("Lamp_Bulb", (lamp_head[0], lamp_head[1], lamp_head[2] + 9), 60, 2400, 60, src=2.0, shadows=False)  # lights the shade and base
    tag(bulb)
    rect("Fluorescent_Fill", (cx + 120, 60, H - 6), (0, -90, 0), 150, 5600, 120, 15, 900, vol=0.2)
    # cold window light from back-left (fill, 3-4 stops under the key) and a back-rim on the opponent's shoulder
    # keeps its shadow (C2): it faces the camera from the back wall, and without one its 7500 K light passed through the
    # opponent onto the board and hands (r/g 1.44 -> 1.33); the window bars' shadow also shapes its shafts in the fog
    # C9: moved with the window into the seat view (window block, TC_WINDOW): just inside the panes, behind the bars, the
    # source the size of the glass. From behind the opponent's right shoulder it is now also his cold back light.
    # In view, the old 2500 lm / volumetric 3.0 lit the haze, wall, beds and cabinet in front of the camera (C9 build A:
    # main mean +6.0, g/b 1.63 -> 1.46, below V1): 600 lm / 1.0 and BackWall_Wash 4500 -> 2600 pay for the window
    # (C9-metrics.json). TC_WINDOW_LIGHT=lumens,volumetric scattering
    wlm, wvol = (float(v) for v in os.environ.get("TC_WINDOW_LIGHT", "600,1.0").split(","))
    rect("Window_Cold", (wf - 2.5, WIN[0], WIN[1]), (0, 0, 180), wlm, 7500, WIN[2], WIN[3], 900, vol=wvol, shadows=True)
    # C7 (judge run 6: "no cold back light"): the back-left rim is the cold accent on the cage, shoulder and chair,
    # 80 lm 6500 K -> TC_RIM lm (default 500) at 9000 K. Shadowless (no RT cost). It also moves g/b and r/g away from
    # their V1 upper limits (main 1.697 -> 1.658, Black r/g 1.496 -> 1.481 with the Lamp_Opponent change below)
    point("Rim", (150, -60, top + 70), float(os.environ.get("TC_RIM", 500)), 9000, 300, src=8.0, shadows=False)
    # aimed at the opponent's chest and hands, not his head (C2: the bald scalp was the brightest thing above the board)
    # C7 (judge run 6: the scalp out-shone the lamp): 170 -> TC_OPP lm (default 140): scalp p99 125 -> 113. 110 lm
    # (p99 100) cost 0.11 of V2 detail on the opponent; a 30 deg cone at 170 lm made the scalp brighter (p99 160)
    tag(spot("Lamp_Opponent", lamp_head, look_at_rot(lamp_head, (68, 0, top + 18)), float(os.environ.get("TC_OPP", 140)), 2400, 400, float(os.environ.get("TC_OPPCONE", 40)), src=2.5, vol=0.6))
    rect("BackWall_Wash", (cx + L / 2 - 60, 0, 270), (0, -55, 0), float(os.environ.get("TC_WASH", 2600)), 6800, 260, 40, 700, vol=1.5)
    # pass C2: no subject fills without a source (VISUAL_ART_DIRECTION section 4.5). Hands_Key (200 lm from the camera
    # side, 40 cm over the near table) and Table_Right (80 lm) are gone. The lamp sits beyond the board's left half, so
    # with its key alone every piece was backlit (s2: board mean 57 -> 23, pieces in silhouette): one soft warm bounce
    # from the lamp's side (its light off the papers and table left of the board), low and from the left, at half power.
    tag(rect("Lamp_Bounce", (-12, -62, top + 22), look_at_rot((-12, -62, top + 22), (-8, 0, top)), 100, 2700, 90, 50, 170, vol=0.0))
    # C2.3: the lamp's light coming back off the lit table, the papers and the player's own body: a low, wide, shadowless
    # warm bounce from the player's side so the camera-facing sides of the white pieces stay light (C2.2 left them tan,
    # close to the black set; lead review). Kept low and dim so the hands stay under the board.
    tag(rect("Table_Bounce", (-62, 0, top + 8), look_at_rot((-62, 0, top + 8), (0, 0, top + 4)), float(os.environ.get("TC_TBOUNCE", 90)), 2900, 110, 25, 150, vol=0.0))
    # (the table bounce light over-lit the board: 11.7% clipped pixels; removed, Lumen GI does the bounce)
    # corridor light behind the bars: a cold glow that separates the opponent from the back wall
    rect("Corridor_Glow", (cx + L / 2 - 30, 40, 230), (0, -70, 0), 2200, 7200, 80, 30, 500, vol=2.0)

    sky = EAS.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 400), unreal.Rotator(0, 0, 0))
    setp(sky.light_component, "intensity", 0.07)  # lift the blacks a little: the reference never crushes the room (C2: 0.09 changed nothing measurable)
    sky.set_folder_path("Lights")

    fog = EAS.spawn_actor_from_class(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    fc = fog.component
    # C2: denser, flatter haze (0.035 / 0.002 was invisible: the room behind the opponent rendered black) so the lamp's
    # cone, the window and the corridor glow scatter visibly behind the opponent
    setp(fc, "fog_density", float(os.environ.get("TC_FOG", 0.045)))
    setp(fc, "fog_height_falloff", 0.001)
    setp(fc, "enable_volumetric_fog", True)
    setp(fc, "volumetric_fog_scattering_distribution", 0.7)
    setp(fc, "volumetric_fog_extinction_scale", 1.0)
    setp(fc, "volumetric_fog_albedo", unreal.Color(200, 196, 188, 255))
    fog.set_folder_path("Atmosphere")

    # ---- Camera: seated eye height, natural focal length, focus on the board.
    # Pass C1 (hands specialist, camera block lent by the lead): the art-direction standard at the DEFAULT view height
    # 0.6. The level camera sits where ApplyView's offsets bring it onto the standard: 16.8 cm lower, 3 cm back, pitch
    # 6 deg higher, focal 30 / 0.88 = 34.1 mm. (Was eye (-87, top+42), pitch -19, 30 mm before the offsets: at the default
    # view that put the board's near edge at the frame bottom and cut both wrists.)
    v = VIEW_DEFAULT
    eye = (SEAT_EYE_X - VIEW_FWD * v, 0.0, top + SEAT_EYE_DZ - VIEW_UP * v)
    PITCH = SEAT_PITCH + VIEW_PITCH * v
    cam = EAS.spawn_actor_from_class(unreal.CineCameraActor, unreal.Vector(*eye), unreal.Rotator(0, PITCH, 0))
    cam.set_actor_label("PlayerEye")
    tag(cam, "TC_Camera_White")
    cc = cam.get_cine_camera_component()
    fb = cc.get_editor_property("filmback")
    setp(fb, "sensor_width", 36.0)
    setp(fb, "sensor_height", 20.25)
    setp(cc, "filmback", fb)
    setp(cc, "current_focal_length", SEAT_FOCAL / (1.0 - VIEW_FOCAL * v))
    setp(cc, "current_aperture", 16.0)
    fs = cc.get_editor_property("focus_settings")
    # no depth of field (the standard: f/16 or DOF off; ApplyView rewrites the manual distance to the board centre,
    # ~96 cm, where f/16 would still soften the hands at 60 cm): everything from the hands to the opponent is sharp
    setp(fs, "focus_method", getattr(unreal.CameraFocusMethod, "DISABLE", unreal.CameraFocusMethod.MANUAL))
    setp(fs, "manual_focus_distance", 85.0)
    setp(cc, "focus_settings", fs)
    if not GAMEPLAY:
        setp(cam, "auto_activate_for_player", unreal.AutoReceiveInput.PLAYER0)
    else:
        # Black's seat: the same framing from the other side of the table (the game picks the camera per seat)
        cam_b = EAS.spawn_actor_from_class(unreal.CineCameraActor, unreal.Vector(-eye[0], 0, eye[2]), unreal.Rotator(0, PITCH, 180))
        cam_b.set_actor_label("PlayerEyeBlack")
        tag(cam_b, "TC_Camera_Black")
        cb = cam_b.get_cine_camera_component()
        setp(cb, "filmback", cc.get_editor_property("filmback"))
        setp(cb, "current_focal_length", cc.get_editor_property("current_focal_length"))
        setp(cb, "current_aperture", cc.get_editor_property("current_aperture"))
        setp(cb, "focus_settings", cc.get_editor_property("focus_settings"))

    # Screenshot capture parked at the eye: -RenderOffscreen never reads the game viewport back, so the benchmark
    # driver switches this on to grab the player's view (Scripts/bench_game.py).
    shot = EAS.spawn_actor_from_class(unreal.SceneCapture2D, unreal.Vector(*eye), unreal.Rotator(0, PITCH, 0))
    shot.set_actor_label("ShotCapture")
    sc = shot.capture_component2d
    setp(sc, "capture_every_frame", False)
    setp(sc, "capture_on_movement", False)
    setp(sc, "capture_source", unreal.SceneCaptureSource.SCS_FINAL_TONE_CURVE_HDR)
    setp(sc, "always_persist_rendering_state", True)

    # ---- Post: fixed exposure, restrained bloom/vignette/grain, Lumen quality.
    ppv = EAS.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    setp(ppv, "unbound", True)
    s = ppv.settings
    for k, v in {
        "auto_exposure_method": unreal.AutoExposureMethod.AEM_HISTOGRAM,
        # EV 8.3 (was 7.8): the frame measured mean 35 / 95th pct 139 against the reference's 27 / 97 (pass 47)
        "auto_exposure_min_brightness": float(os.environ.get("TC_EV", 8.45)),
        "auto_exposure_max_brightness": float(os.environ.get("TC_EV", 8.45)),
        # C2: vignette 0.65 -> 0.4 and grain 0.5 -> 0.2 (the grain fed the V2 detail metric without being detail)
        "bloom_intensity": 0.3, "vignette_intensity": 0.4, "film_grain_intensity": float(os.environ.get("TC_GRAIN", 0.2)),
        "film_toe": 0.5,  # C2: 0.55 -> 0.5 lifts the deepest shadows a little (0.45 read milky)
        "lumen_final_gather_quality": 2.0, "lumen_reflection_quality": 1.0,
        "lumen_scene_lighting_quality": 1.0, "lumen_scene_detail": 1.5,
        "scene_fringe_intensity": 0.15,
        # grading towards the reference (visual judge: our saturation 189/255 vs 150): desaturated, cooler shadows
        "color_saturation": unreal.Vector4(0.8, 0.8, 0.8, 1.0),
        "color_saturation_shadows": unreal.Vector4(0.85, 0.9, 1.0, 0.9),
        "color_gain_shadows": unreal.Vector4(0.97, 0.98, 1.01, 1.0),  # C2: was 0.92/0.97/1.05 (cooled and crushed the room)
        "color_contrast": unreal.Vector4(1.0, 1.0, 1.0, 1.0),
        # measured against the reference panel (pass 47): highlights 148 vs 97 (95th pct), red/green 1.63 vs 1.44,
        # green/blue 1.45 vs 1.62 -> compress the highlights and move the grade from orange towards olive
        "color_gain_highlights": unreal.Vector4(0.78, 0.78, 0.78, 1.0),  # C2: 0.74 -> 0.78, specular peaks on the pieces
        "color_gain": unreal.Vector4(0.92, 1.0, 0.88, 1.0),  # C2: warmer (0.84/1/0.96 before): the lifted toe and the haze cooled the frame  # pass 54: r/g 1.54 -> ref 1.44, g/b 1.72 -> ref 1.62
    }.items():
        try:
            s.set_editor_property("override_" + k, True)
            s.set_editor_property(k, v)
        except Exception as e:  # property names drift between engine versions; log and continue
            log("post setting skipped", k, e)
    setp(ppv, "settings", s)
    ppv.set_folder_path("Atmosphere")

    if not LES.save_current_level():
        raise RuntimeError("save_current_level failed")
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    n = len(EAS.get_all_level_actors())
    if n < (60 if GAMEPLAY else 100):  # room + table + 33 chess meshes + props + lights: anything far below means the build went wrong
        raise RuntimeError(f"only {n} actors in the saved level")
    log("BUILD OK", level_path, n, "actors")


try:
    build()
except Exception:
    log("BUILD FAILED\n" + traceback.format_exc())
finally:
    if os.environ.get("TC_QUIT", "1") == "1":
        unreal.SystemLibrary.quit_editor()
