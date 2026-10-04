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

    uv = expr(unreal.MaterialExpressionTextureCoordinate, -1400, 0)
    tiling = scalar("Tiling", 1.0, -1400, 120)
    uvm = expr(unreal.MaterialExpressionMultiply, -1200, 0)
    MEL.connect_material_expressions(uv, "", uvm, "A")
    MEL.connect_material_expressions(tiling, "", uvm, "B")

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
    gmask = expr(unreal.MaterialExpressionSaturate, -380, -1000)
    MEL.connect_material_expressions(gmul, "", gmask, "")
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
    MEL.connect_material_property(bcf, "", unreal.MaterialProperty.MP_BASE_COLOR)

    # Normal strength: lerp flat → sampled.
    flat = expr(unreal.MaterialExpressionConstant3Vector, -700, 120)
    flat.set_editor_property("constant", unreal.LinearColor(0, 0, 1, 1))
    nstr = scalar("NormalStrength", 1.0, -700, 200)
    nl = expr(unreal.MaterialExpressionLinearInterpolate, -450, 0)
    MEL.connect_material_expressions(flat, "", nl, "A")
    MEL.connect_material_expressions(nm, "RGB", nl, "B")
    MEL.connect_material_expressions(nstr, "", nl, "Alpha")
    MEL.connect_material_property(nl, "", unreal.MaterialProperty.MP_NORMAL)

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
    rsat = expr(unreal.MaterialExpressionSaturate, -100, 400)
    MEL.connect_material_expressions(radd, "", rsat, "")
    MEL.connect_material_property(rsat, "", unreal.MaterialProperty.MP_ROUGHNESS)
    ms = scalar("MetallicScale", 0.0, -700, 560)
    mm = expr(unreal.MaterialExpressionMultiply, -450, 540)
    MEL.connect_material_expressions(arm, "B", mm, "A")
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


def model_material(master, model, prefix, name, **kw):
    """Material instance from a Poly Haven model's own maps (diff, nor_gl, rough, optional metal) on the layered
    master, so the hero meshes get correct scanned colour plus our wear layers instead of the FBX importer's guess."""
    d = os.path.join(ASSETS, "models", model, "textures")
    dest = f"{ROOT}/Textures/{model}"
    maps = {}
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
        elif "_rough_" in stem:
            maps["RoughTex"] = import_texture(os.path.join(d, f), dest, "T_" + stem, "gray")
    sc = dict(kw.pop("scalars", {}) or {})
    if "RoughTex" in maps:
        sc["UseRoughTex"] = 1.0
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


def build_seated_pose(skel_mesh, base_anim, dest, name, own_proportions=False):
    """Authors a single-frame seated pose for the UE5 mannequin.

    Starts from MM_Idle frame 0, infers the bone hierarchy from local vs component transforms, applies
    component-space rotations (mannequin faces +Y, up is +Z), re-derives local transforms and keys them into a new
    AnimSequence. Deltas are about the component X axis: +90 swings a hanging limb forward."""
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
        # come from the target mesh's reference pose so its proportions are kept.
        ref = unreal.AnimPoseExtensions.get_reference_pose(skel_mesh.get_editor_property("skeleton"))
        ref_names = {str(n) for n in unreal.AnimPoseExtensions.get_bone_names(ref)}
        for b in names:
            if b in ref_names:
                loc[b] = (_xf(unreal.AnimPoseExtensions.get_bone_pose(ref, b, unreal.AnimPoseSpaces.LOCAL))[0], loc[b][1])
        names = [b for b in names if b in ref_names]

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

    X = (1.0, 0.0, 0.0)
    deltas = {  # component-space rotation applied to each bone's current world orientation, top-down
        "spine_01": _axis(X, -6), "spine_03": _axis(X, -8), "neck_01": _axis(X, 4), "head": _axis(X, 14),
        "thigh_l": _axis(X, 90), "thigh_r": _axis(X, 90),
        "calf_l": _axis(X, -90), "calf_r": _axis(X, -90),
        "upperarm_l": _axis(X, 52), "upperarm_r": _axis(X, 52),
        "lowerarm_l": _axis(X, 50), "lowerarm_r": _axis(X, 50),
    }
    pelvis_drop = float(os.environ.get("TC_PELVIS_DROP", 47.0))

    new_w = {}
    new_l = dict(loc)
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
            t_w = (t_w[0], t_w[1], t_w[2] - pelvis_drop)
        if b in deltas:
            q_w = _qmul(deltas[b], q_w)
        if (b in deltas or b == "pelvis") and p is not None:
            tp, qp = new_w[p]
            iq = _qinv(qp)
            d = (t_w[0] - tp[0], t_w[1] - tp[1], t_w[2] - tp[2])
            new_l[b] = (_qrot(iq, d), _qmul(iq, q_w))
        new_w[b] = (t_w, q_w)

    # head in the seated pose (component space) and its idle orientation, for props attached to the head bone
    SEATED["head"] = (new_w["head"][0], new_w["head"][1], wld["head"][1])

    path = f"{dest}/{name}"
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    f = unreal.AnimSequenceFactory()
    f.set_editor_property("target_skeleton", skel_mesh.get_editor_property("skeleton"))
    f.set_editor_property("preview_skeletal_mesh", skel_mesh)
    seq = AT.create_asset(name, dest, unreal.AnimSequence, f)
    ctrl = seq.controller
    ctrl.open_bracket(unreal.Text("TC seated pose"), False)
    ctrl.set_frame_rate(unreal.FrameRate(30, 1), False)
    ctrl.set_number_of_frames(unreal.FrameNumber(1), False)
    for b in names:
        t, q = new_l[b]
        tv = unreal.Vector(*t)
        qv = unreal.Quat(*q)
        sv = unreal.Vector(1, 1, 1)
        ctrl.add_bone_curve(b, False) if not hasattr(ctrl, "add_bone_track") else ctrl.add_bone_track(b, False)
        ctrl.set_bone_track_keys(b, [tv, tv], [qv, qv], [sv, sv], False)
    ctrl.close_bracket(False)
    EAL.save_loaded_asset(seq)
    log("seated pose", path, len(names), "bones; pelvis", new_w.get("pelvis", ((0, 0, 0),))[0],
        "head", new_w.get("head", ((0, 0, 0),))[0], "hand_l", new_w.get("hand_l", ((0, 0, 0),))[0])
    return seq


# ---------------------------------------------------------------- lights / camera / post

def spot(label, loc, rot, lumens, kelvin, radius, cone, src=2.0, vol=1.0):
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
    a.set_actor_label(label)
    a.set_folder_path("Lights")
    return a


def rect(label, loc, rot, lumens, kelvin, w, h, radius, vol=0.3):
    a = EAS.spawn_actor_from_class(unreal.RectLight, unreal.Vector(*loc), unreal.Rotator(*rot))
    c = a.rect_light_component
    setp(c, "intensity_units", unreal.LightUnits.LUMENS)
    setp(c, "intensity", lumens)
    setp(c, "use_temperature", True)
    setp(c, "temperature", kelvin)
    setp(c, "source_width", w)
    setp(c, "source_height", h)
    setp(c, "attenuation_radius", radius)
    setp(c, "volumetric_scattering_intensity", vol)
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

def build():
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    level_path = f"{ROOT}/{LEVEL}"
    # The project opens L_Bench at startup, so it cannot be deleted/recreated in place (NewLevel refuses: "an asset
    # already exists"), and actors would land in an unsaved transient world. Load it and clear it instead.
    if EAL.does_asset_exist(level_path):
        if not LES.load_level(level_path):
            raise RuntimeError(f"could not load {level_path}")
        keep = (unreal.WorldSettings, unreal.Brush)
        doomed = [a for a in EAS.get_all_level_actors() if not isinstance(a, keep)]
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
    defaults["gray"] = import_texture(os.path.join(tmp, "T_TC_White.png"), f"{ROOT}/Textures", "T_TC_WhiteGray", "gray")
    grime_png(os.path.join(tmp, "T_TC_Grime.png"))
    defaults["grime"] = import_texture(os.path.join(tmp, "T_TC_Grime.png"), f"{ROOT}/Textures", "T_TC_Grime", "linear")
    master = build_master_material(defaults)

    mi_floor = surface_material(master, "old_linoleum_flooring_01", tiling=3.0, tint=(0.55, 0.55, 0.48),
                                scalars={"GrimeTiling": 0.6, "GrimeThreshold": 0.45, "GrimeContrast": 2.0})
    mi_wall = surface_material(master, "damaged_plaster", tiling=2.0, tint=(0.55, 0.6, 0.52), grime_color=(0.35, 0.3, 0.22),
                               scalars={"GrimeTiling": 0.8, "GrimeThreshold": 0.38, "GrimeContrast": 1.8, "GrimeStreaks": 0.6})
    mi_wall_low = surface_material(master, "dirty_tiles", tiling=3.0, tint=(0.62, 0.66, 0.6), grime_color=(0.3, 0.26, 0.18),
                                   scalars={"GrimeTiling": 0.7, "GrimeThreshold": 0.35, "GrimeContrast": 1.6, "GrimeStreaks": 0.7})
    mi_rust = surface_material(master, "rusty_metal_02", tiling=1.0, metal=1.0, tint=(0.5, 0.45, 0.4),
                               scalars={"GrimeTiling": 2.0, "GrimeThreshold": 0.45, "GrimeContrast": 2.0})
    mi_cloth = surface_material(master, "rough_linen", name="MI_OpponentCloth", tiling=6.0, tint=(0.24, 0.23, 0.2), grime_color=(0.35, 0.25, 0.16),
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
    assign(table, surface_material(master, "wood_table_worn", tiling=1.0, grime_color=(0.3, 0.22, 0.15), tint=(0.7, 0.6, 0.5),
                                   scalars={"GrimeTiling": 1.3, "GrimeThreshold": 0.32, "GrimeContrast": 2.0,
                                            "GrimeStreaks": 0.5, "MicroRough": 0.2}))
    tlo, thi = bounds_of(table)
    # Long side runs across the player's view (along Y). Poly Haven models are centred on their origin in XY.
    yaw = 90.0 if (thi[0] - tlo[0]) > (thi[1] - tlo[1]) else 0.0
    place_model(table, (0, 0, 0), yaw=yaw, label="Table", sit_on=0.0)
    top = thi[2] - tlo[2]
    log("table bounds", tlo, thi, "top", top)

    # ---- Chess set: board + 32 pieces; rotate so White faces the player (-X).
    chess = import_model("chess_set")
    # Hero materials: scanned maps + handling wear (micro smudges on the pieces, grime worked into the board)
    mi_pw = model_material(master, "chess_set", "chess_set_pieces_white", "MI_PiecesWhite", grime_color=(0.55, 0.43, 0.3), tint=(0.95, 0.85, 0.68), rough=0.75,
                           scalars={"GrimeTiling": 3.0, "GrimeThreshold": 0.6, "GrimeContrast": 2.5, "MicroRough": 0.25})
    mi_pb = model_material(master, "chess_set", "chess_set_pieces_black", "MI_PiecesBlack", grime_color=(2.2, 2.0, 1.8), rough=0.5, tint=(0.11, 0.095, 0.085),
                           scalars={"GrimeTiling": 3.0, "GrimeThreshold": 0.75, "GrimeContrast": 2.0, "MicroRough": 0.15})
    mi_cb = model_material(master, "chess_set", "chess_set_board", "MI_ChessBoard", grime_color=(0.42, 0.32, 0.22), tint=(0.85, 0.77, 0.62),
                           scalars={"GrimeTiling": 1.7, "GrimeThreshold": 0.4, "GrimeContrast": 2.5, "MicroRough": 0.2})
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
        setp(board, "board_mesh_yaw", 90.0)  # a1 must be a dark square ("light on the right"), checked by screenshot
        log("board pieces", sorted(meshes.keys()))
    else:
        place_model(chess, (0, 0, 0), yaw=cyaw, label="Chess", sit_on=top)

    # ---- Props with intentional placement.
    # Dome desk lamp (props.py): upper-left of frame, arm reaching towards the board; the key light sits at its bulb.
    lamp = import_prop("dome_lamp")
    mi_brass = surface_material(master, "rusty_metal_02", name="MI_Brass", tiling=1.5, metal=1.0, tint=(0.8, 0.6, 0.32), rough=0.7,
                                scalars={"GrimeTiling": 2.0, "GrimeThreshold": 0.5, "GrimeContrast": 2.0, "MicroRough": 0.15})
    bulb_mat = emissive_material("M_TC_Bulb", (1.0, 0.62, 0.3), 60.0)
    for sm in lamp:
        for i, sl in enumerate(sm.static_materials):
            sm.set_material(i, bulb_mat if "bulb" in str(sl.material_slot_name).lower() else mi_brass)
        EAL.save_loaded_asset(sm)
    LAMP_BASE, LAMP_YAW = (12.0, -62.0), 101.0
    lamp_actors, llo, lhi = place_model(lamp, (LAMP_BASE[0], LAMP_BASE[1], 0), yaw=LAMP_YAW, label="Lamp", sit_on=top)
    tag(lamp_actors)
    yr = math.radians(LAMP_YAW)
    lamp_bulb = (LAMP_BASE[0] + 24 * math.cos(yr), LAMP_BASE[1] + 24 * math.sin(yr), top + 38.5)
    log("lamp bounds", llo, lhi, "bulb", lamp_bulb)
    clock = import_model("alarm_clock_01")
    if clock:  # this FBX currently imports without a static mesh; skip rather than fail
        place_model(clock, (-8, 46, 0), yaw=-150, label="Clock", sit_on=top)
    mug = import_prop("tin_mug")
    tag(place_model(mug, (38, 46, 0), yaw=-120, label="Mug", sit_on=top)[0])
    for sm in mug:
        sm.set_material(0, mi_rust)
        EAL.save_loaded_asset(sm)
    beds = import_model("old_bed_frame")
    if beds:
        place_model(beds, (cx + L / 2 - 55, -120, 0), yaw=90, label="BedA", sit_on=0.0)
        place_model(beds, (cx + L / 2 - 55, 125, 0), yaw=90, label="BedB", sit_on=0.0)
    # barred window high on the back wall, left of the opponent: cold glow + rusty bars (the window rect light sits in it)
    glow = emissive_material("M_TC_WindowGlow", (0.55, 0.7, 0.8), 6.0)
    box("Window_Glow", (cx + L / 2 - 1, -150, 185), (2, 60, 90), glow, folder="Window")
    cyl = unreal.load_asset("/Engine/BasicShapes/Cylinder")
    for k in range(6):
        b = EAS.spawn_actor_from_object(cyl, unreal.Vector(cx + L / 2 - 5, -150 - 25 + k * 10, 185), unreal.Rotator(0, 0, 0))
        b.set_actor_scale3d(unreal.Vector(0.022, 0.022, 0.92))
        b.static_mesh_component.set_material(0, mi_rust)
        b.set_folder_path("Window")
    binder = import_model("binder_notebook")
    place_model(binder, (-30, -40, 0), yaw=12, label="Binder", sit_on=top)
    chair = import_model("painted_wooden_chair_01")
    tag(place_model(chair, (92, 0, 0), yaw=180, label="OpponentChair", sit_on=0.0)[0])
    cabinet = import_model("drawer_cabinet")
    place_model(cabinet, (cx + L / 2 - 40, -140, 0), yaw=180, label="Cabinet", sit_on=0.0)
    wheel = import_model("wheelchair_01")
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

    def spawn_opponent(opp_id, mhn, outfit_mi=None):
        """Body (seated pose), face and outfit as skeletal mesh actors; the game links face/outfit to the body."""
        opp_tag = f"TC_Opponent_{opp_id}"
        mh_body = unreal.load_asset(f"/Game/TownChess/MetaHumans/Built/{mhn}/Body/SKM_{mhn}_BodyMesh") if GAMEPLAY and mhn else None
        body_mesh = mh_body or manny
        if not (idle and body_mesh):
            log("WARNING: no body for", opp_id)
            return None, None
        key = body_mesh.get_path_name()
        if key not in seated_cache:
            try:
                seated_cache[key] = (build_seated_pose(body_mesh, idle, f"{ROOT}/Anims", f"A_TC_Seated_{body_mesh.get_name()}",
                                                       own_proportions=bool(mh_body)), dict(SEATED))
            except Exception:
                log("WARNING seated pose failed\n" + traceback.format_exc())
                seated_cache[key] = (None, dict(SEATED))
        seated, head = seated_cache[key]
        SEATED.update(head)
        opp = EAS.spawn_actor_from_object(body_mesh, unreal.Vector(90, 0, 0), unreal.Rotator(0, 0, 90))  # mesh faces +Y; yaw 90 -> -X
        opp.set_actor_label(f"Opponent_{opp_id}")
        smc = opp.skeletal_mesh_component
        tag(opp); tag(opp, opp_tag); tag(opp, "TC_Body")
        setp(smc, "animation_mode", unreal.AnimationMode.ANIMATION_SINGLE_NODE)
        data = unreal.SingleAnimationPlayData()
        setp(data, "anim_to_play", seated or idle)
        setp(data, "saved_looping", True)
        setp(data, "saved_playing", True)
        setp(smc, "animation_data", data)
        if mh_body:
            followers = []
            face = unreal.load_asset(f"/Game/TownChess/MetaHumans/Built/{mhn}/Face/SKM_{mhn}_FaceMesh")
            if face:
                followers.append(("Face", face, None))
            # outfit meshes: the body hides the skin under them, so they must be present or the torso renders as a hole
            for p in EAL.list_assets(f"/Game/TownChess/MetaHumans/Built/{mhn}/Clothing", recursive=False):
                cm = unreal.load_asset(p)
                if isinstance(cm, unreal.SkeletalMesh):
                    followers.append((cm.get_name(), cm, outfit_mi))
            for label, mesh, mi in followers:
                f = EAS.spawn_actor_from_object(mesh, unreal.Vector(90, 0, 0), unreal.Rotator(0, 0, 90))
                f.set_actor_label(f"Opponent_{opp_id}_{label}")
                f.skeletal_mesh_component.set_mobility(unreal.ComponentMobility.MOVABLE)
                f.attach_to_actor(opp, "", R.KEEP_WORLD, R.KEEP_WORLD, R.KEEP_WORLD, False)
                if mi:
                    for i in range(f.skeletal_mesh_component.get_num_materials()):
                        f.skeletal_mesh_component.set_material(i, mi)
                tag(f); tag(f, opp_tag); tag(f, "TC_FollowBody")
        else:
            for i in range(smc.get_num_materials()):
                smc.set_material(i, mi_cloth)
        log("opponent", opp_id, "body", body_mesh.get_name())
        return opp, smc

    mhn = os.environ.get("TC_MH_NAME", "MH_Walter")
    if not EAL.does_asset_exist(f"/Game/TownChess/MetaHumans/Built/{mhn}/BP_{mhn}"):
        mhn = "MH_Opponent" if EAL.does_asset_exist("/Game/TownChess/MetaHumans/Built/MH_Opponent/BP_MH_Opponent") else None

    # 1. The caged patient: Blender cage mask over the face
    opp, smc = spawn_opponent("caged", mhn)
    if smc and "head" in SEATED:
        cage = import_prop("cage_mask")
        if cage:
            cage[0].set_material(0, mi_rust)
            EAL.save_loaded_asset(cage[0])
            off = [float(v) for v in os.environ.get("TC_MASK_OFFSET", "0,4.5,-1").split(",")]  # forward (+Y), up (+Z) from the head bone
            attach_static("CageMask", cage[0], smc, "head", *head_relative(off), "TC_Opponent_caged")

    # 2. The Annotator: slate-green coat, tan oversleeves, linen coif, two-leaf riveted plate, ledger and pencil
    mi_coat = surface_material(master, "rough_linen", name="MI_AnnotatorCoat", tiling=8.0, tint=(0.243, 0.29, 0.263),
                               scalars={"GrimeTiling": 1.2, "GrimeThreshold": 0.55, "GrimeContrast": 2.0})
    mi_duck = surface_material(master, "rough_linen", name="MI_Oversleeve", tiling=6.0, tint=(0.62, 0.52, 0.38),
                               grime_color=(0.35, 0.33, 0.32), scalars={"GrimeTiling": 1.5, "GrimeThreshold": 0.5, "GrimeContrast": 2.5})
    mi_coif = surface_material(master, "rough_linen", name="MI_Coif", tiling=7.0, tint=(0.5, 0.47, 0.42),
                               scalars={"GrimeTiling": 1.0, "GrimeThreshold": 0.45, "GrimeContrast": 2.0})
    mi_steel = surface_material(master, "rusty_metal_02", name="MI_MaskSteel", tiling=1.5, metal=1.0, tint=(0.6, 0.6, 0.6), rough=0.55,
                                scalars={"GrimeTiling": 2.0, "GrimeThreshold": 0.6, "GrimeContrast": 2.0, "MicroRough": 0.2})
    mi_copper = surface_material(master, "rusty_metal_02", name="MI_Copper", tiling=3.0, metal=1.0, tint=(0.95, 0.5, 0.32), rough=0.45)
    mi_black = make_mi(master, "MI_Pupil", {"BaseColor": None}, tint=(0.01, 0.01, 0.01), rough=0.9)
    mi_oxblood = surface_material(master, "brown_leather", name="MI_LedgerCloth", tiling=3.0, tint=(0.36, 0.09, 0.08), rough=0.85)
    mi_pages = make_mi(master, "MI_Pages", {"BaseColor": None}, tint=(0.78, 0.72, 0.6), rough=0.95)
    opp_a, smc_a = spawn_opponent("annotator", mhn, outfit_mi=mi_coat)
    if smc_a and "head" in SEATED:
        plate = prop_with("annotator_mask", {"Steel": mi_steel, "Copper": mi_copper, "Pupil": mi_black})
        coif = prop_with("annotator_coif", {"Linen": mi_coif})
        noff = [float(v) for v in os.environ.get("TC_NASION_OFFSET", "0,9.5,7").split(",")]  # head bone -> nasion
        if coif:
            attach_static("AnnotatorCoif", coif, smc_a, "head", *head_relative(noff), "TC_Opponent_annotator")
        if plate:
            attach_static("AnnotatorMask", plate, smc_a, "head", *head_relative([noff[0], noff[1] + 1.2, noff[2]]), "TC_Opponent_annotator")
        over = prop_with("oversleeve", {"Duck": mi_duck})
        coat = prop_with("coat_sleeve", {"Wool": mi_coat})
        for side, flip in (("l", 0.0), ("r", 180.0)):  # right-side bones point back along the arm on this skeleton
            if over:
                attach_static(f"Oversleeve_{side}", over, smc_a, f"lowerarm_{side}", unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, flip), "TC_Opponent_annotator")
            if coat:
                attach_static(f"CoatSleeve_{side}", coat, smc_a, f"upperarm_{side}", unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, flip), "TC_Opponent_annotator")
        led = prop_with("ledger", {"LedgerCloth": mi_oxblood, "Pages": mi_pages, "Ribbon": mi_oxblood})
        pen = prop_with("pencil", {"PencilPaint": mi_coat, "PencilWood": mi_pages, "Ferrule": mi_copper, "Eraser": mi_oxblood})
        for nm, mesh, loc, yaw in (("Ledger", led, (52, -34), 75), ("Pencil", pen, (46, -20), 30)):
            if mesh:
                a = EAS.spawn_actor_from_object(mesh, unreal.Vector(loc[0], loc[1], top + 0.1), unreal.Rotator(0, 0, yaw))
                a.set_actor_label(f"Annotator{nm}")
                tag(a); tag(a, "TC_Opponent_annotator")

    # ---- Player hands (XR mannequin hands as stand-ins), resting near the near board edge.
    for side, y, yaw_h in (("left", -26, 0), ("right", 26, 0)):
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
    tag(spot("Lamp_Key", lamp_head, look_at_rot(lamp_head, (10, -5, top)), 700, 2400, 600, 65, src=2.5, vol=1.2))
    bulb = point("Lamp_Bulb", (lamp_head[0], lamp_head[1], lamp_head[2] + 9), 60, 2400, 60, src=2.0, shadows=False)  # lights the shade and base
    tag(bulb)
    rect("Fluorescent_Fill", (cx + 120, 60, H - 6), (0, -90, 0), 150, 5600, 120, 15, 900, vol=0.2)
    # cold window light from back-left (fill, 3-4 stops under the key) and a back-rim on the opponent's shoulder
    rect("Window_Cold", (cx + L / 2 - 8, -150, 185), (0, 0, 180), 2500, 7500, 60, 90, 900, vol=3.0)
    point("Rim", (150, -60, top + 70), 80, 6500, 300, src=8.0)
    tag(spot("Lamp_Opponent", lamp_head, look_at_rot(lamp_head, (70, 0, top + 45)), 220, 2400, 400, 40, src=2.5, vol=0.6))
    rect("BackWall_Wash", (cx + L / 2 - 60, 0, 270), (0, -55, 0), 1800, 7000, 200, 40, 600, vol=1.5)

    sky = EAS.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 400), unreal.Rotator(0, 0, 0))
    setp(sky.light_component, "intensity", 0.02)
    sky.set_folder_path("Lights")

    fog = EAS.spawn_actor_from_class(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    fc = fog.component
    setp(fc, "fog_density", 0.035)
    setp(fc, "fog_height_falloff", 0.002)
    setp(fc, "enable_volumetric_fog", True)
    setp(fc, "volumetric_fog_scattering_distribution", 0.7)
    setp(fc, "volumetric_fog_extinction_scale", 1.0)
    setp(fc, "volumetric_fog_albedo", unreal.Color(200, 196, 188, 255))
    fog.set_folder_path("Atmosphere")

    # ---- Camera: seated eye height, natural focal length, focus on the board.
    eye = (-87.0, 0.0, top + 42.0)
    PITCH = -15.0  # 16:9 cannot match both the reference's near board edge and its headroom; headroom wins (the opponent is the subject)
    cam = EAS.spawn_actor_from_class(unreal.CineCameraActor, unreal.Vector(*eye), unreal.Rotator(0, PITCH, 0))
    cam.set_actor_label("PlayerEye")
    tag(cam, "TC_Camera_White")
    cc = cam.get_cine_camera_component()
    fb = cc.get_editor_property("filmback")
    setp(fb, "sensor_width", 36.0)
    setp(fb, "sensor_height", 20.25)
    setp(cc, "filmback", fb)
    setp(cc, "current_focal_length", 30.0)
    setp(cc, "current_aperture", 2.8)
    fs = cc.get_editor_property("focus_settings")
    setp(fs, "focus_method", unreal.CameraFocusMethod.MANUAL)
    setp(fs, "manual_focus_distance", 97.0)
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
        "auto_exposure_min_brightness": float(os.environ.get("TC_EV", 8.5)),
        "auto_exposure_max_brightness": float(os.environ.get("TC_EV", 8.5)),
        "bloom_intensity": 0.3, "vignette_intensity": 0.65, "film_grain_intensity": 0.15,
        "lumen_final_gather_quality": 2.0, "lumen_reflection_quality": 1.0,
        "lumen_scene_lighting_quality": 1.0, "lumen_scene_detail": 1.5,
        "scene_fringe_intensity": 0.15,
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
