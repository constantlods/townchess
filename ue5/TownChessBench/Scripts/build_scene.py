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
ROOT = "/Game/Bench"
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
    MEL.connect_material_property(bcm, "", unreal.MaterialProperty.MP_BASE_COLOR)

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
    rs = scalar("RoughnessScale", 1.0, -700, 420)
    rm = expr(unreal.MaterialExpressionMultiply, -450, 380)
    MEL.connect_material_expressions(arm, "G", rm, "A")
    MEL.connect_material_expressions(rs, "", rm, "B")
    MEL.connect_material_property(rm, "", unreal.MaterialProperty.MP_ROUGHNESS)
    ms = scalar("MetallicScale", 0.0, -700, 560)
    mm = expr(unreal.MaterialExpressionMultiply, -450, 540)
    MEL.connect_material_expressions(arm, "B", mm, "A")
    MEL.connect_material_expressions(ms, "", mm, "B")
    MEL.connect_material_property(mm, "", unreal.MaterialProperty.MP_METALLIC)

    MEL.recompile_material(m)
    EAL.save_loaded_asset(m)
    return m


def make_mi(master, name, textures, tiling=1.0, rough=1.0, metal=0.0, tint=None):
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
    MEL.update_material_instance(mi)
    EAL.save_loaded_asset(mi)
    return mi


def surface_material(master, tex_name, **kw):
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
    return make_mi(master, "MI_" + tex_name, maps, **kw)


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


def build_seated_pose(skel_mesh, base_anim, dest, name):
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
    level_path = f"{ROOT}/L_Bench"
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
    master = build_master_material(defaults)

    mi_floor = surface_material(master, "concrete_floor_worn_001", tiling=4.0)
    mi_wall = surface_material(master, "painted_plaster_wall", tiling=3.0, tint=(0.62, 0.66, 0.58))
    mi_wall_low = surface_material(master, "cracked_concrete_wall", tiling=3.0, tint=(0.45, 0.42, 0.36))
    mi_ceiling = make_mi(master, "MI_ceiling", {"BaseColor": None}, tint=(0.22, 0.22, 0.2), rough=0.9)
    surface_material(master, "wood_table_worn", tiling=1.0)
    surface_material(master, "rusty_metal_02", tiling=2.0, metal=1.0)

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
    box("Wainscot_Back", (cx + L / 2 - 1, 0, 55), (4, W, 110), mi_wall_low)
    box("Wainscot_Left", (cx, -W / 2 + 1, 55), (L, 4, 110), mi_wall_low)
    box("Wainscot_Right", (cx, W / 2 - 1, 55), (L, 4, 110), mi_wall_low)

    # ---- Table, centred at origin; its top height drives everything else.
    table = import_model("wooden_table_02")
    tlo, thi = bounds_of(table)
    # Long side runs across the player's view (along Y). Poly Haven models are centred on their origin in XY.
    yaw = 90.0 if (thi[0] - tlo[0]) > (thi[1] - tlo[1]) else 0.0
    place_model(table, (0, 0, 0), yaw=yaw, label="Table", sit_on=0.0)
    top = thi[2] - tlo[2]
    log("table bounds", tlo, thi, "top", top)

    # ---- Chess set: board + 32 pieces; rotate so White faces the player (-X).
    chess = import_model("chess_set")
    king_w = next((m for m in chess if "king_white" in m.get_name()), None)
    cyaw = 0.0
    if king_w:
        b = king_w.get_bounding_box()
        kx, ky = (b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2
        cyaw = math.degrees(math.atan2(0, -1) - math.atan2(ky, kx))
        log("white king at", kx, ky, "-> yaw", cyaw)
    place_model(chess, (0, 0, 0), yaw=cyaw, label="Chess", sit_on=top)

    # ---- Props with intentional placement.
    lamp = import_model("desk_lamp_arm_01")
    # Upper-left of frame, arm reaching over the board's corner.
    _, llo, lhi = place_model(lamp, (30, -52, 0), yaw=70, label="Lamp", sit_on=top)
    log("lamp bounds", llo, lhi)
    clock = import_model("alarm_clock_01")
    if clock:  # this FBX currently imports without a static mesh; skip rather than fail
        place_model(clock, (-8, 46, 0), yaw=-150, label="Clock", sit_on=top)
    binder = import_model("binder_notebook")
    place_model(binder, (-30, -40, 0), yaw=12, label="Binder", sit_on=top)
    chair = import_model("painted_wooden_chair_01")
    place_model(chair, (92, 0, 0), yaw=180, label="OpponentChair", sit_on=0.0)
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
    if manny and idle:
        seated = None
        try:
            seated = build_seated_pose(manny, idle, f"{ROOT}/Anims", "A_TC_Seated")
        except Exception:
            log("WARNING seated pose failed\n" + traceback.format_exc())
        opp = EAS.spawn_actor_from_object(manny, unreal.Vector(90, 0, 0), unreal.Rotator(0, 0, 90))  # mesh faces +Y; yaw 90 -> faces -X
        opp.set_actor_label("Opponent")
        smc = opp.skeletal_mesh_component
        setp(smc, "animation_mode", unreal.AnimationMode.ANIMATION_SINGLE_NODE)
        data = unreal.SingleAnimationPlayData()
        setp(data, "anim_to_play", seated or idle)
        setp(data, "saved_looping", True)
        setp(data, "saved_playing", True)
        setp(smc, "animation_data", data)
    else:
        log("WARNING: mannequin not found")

    # ---- Player hands (XR mannequin hands as stand-ins), resting near the near board edge.
    for side, y, yaw_h in (("left", -26, 0), ("right", 26, 0)):
        hm = unreal.load_asset(f"/Game/XRMannequins/Meshes/SKM_MannyXR_{side}")
        if hm:
            b = hm.get_bounds()
            log("hand", side, "bounds origin", b.origin, "extent", b.box_extent)
            # Fingers point along +Y in mesh space; yaw -90 points them at the board (+X).
            h = EAS.spawn_actor_from_object(hm, unreal.Vector(-22, y * 1.35, top + 6), unreal.Rotator(0, 0, -90))
            h.set_actor_label(f"Hand_{side}")
            h.set_folder_path("Player")
        else:
            log("WARNING: XR hand not found", side)

    # ---- Lighting: warm practical lamp (key), cool fluorescent fill, cool rim.
    lamp_head = (24, -34, top + (lhi[2] - llo[2]) - 8)
    spot("Lamp_Key", lamp_head, look_at_rot(lamp_head, (4, 0, top)), 450, 2700, 600, 58, src=3.0, vol=1.6)
    bulb = point("Lamp_Bulb", (lamp_head[0], lamp_head[1], lamp_head[2] + 2), 60, 2700, 120, src=2.0, shadows=False)
    rect("Fluorescent_Fill", (cx + 120, 60, H - 6), (0, -90, 0), 2200, 6200, 120, 15, 900, vol=0.2)
    point("Rim", (170, 80, 190), 120, 7000, 400, src=8.0)

    sky = EAS.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 400), unreal.Rotator(0, 0, 0))
    setp(sky.light_component, "intensity", 0.02)
    sky.set_folder_path("Lights")

    fog = EAS.spawn_actor_from_class(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    fc = fog.component
    setp(fc, "fog_density", 0.02)
    setp(fc, "fog_height_falloff", 0.002)
    setp(fc, "enable_volumetric_fog", True)
    setp(fc, "volumetric_fog_scattering_distribution", 0.7)
    setp(fc, "volumetric_fog_extinction_scale", 1.0)
    setp(fc, "volumetric_fog_albedo", unreal.Color(200, 196, 188, 255))
    fog.set_folder_path("Atmosphere")

    # ---- Camera: seated eye height, natural focal length, focus on the board.
    eye = (-66.0, 0.0, top + 50.0)
    cam = EAS.spawn_actor_from_class(unreal.CineCameraActor, unreal.Vector(*eye), unreal.Rotator(0, -27, 0))
    cam.set_actor_label("PlayerEye")
    cc = cam.get_cine_camera_component()
    fb = cc.get_editor_property("filmback")
    setp(fb, "sensor_width", 36.0)
    setp(fb, "sensor_height", 20.25)
    setp(cc, "filmback", fb)
    setp(cc, "current_focal_length", 24.0)
    setp(cc, "current_aperture", 4.0)
    fs = cc.get_editor_property("focus_settings")
    setp(fs, "focus_method", unreal.CameraFocusMethod.MANUAL)
    setp(fs, "manual_focus_distance", 75.0)
    setp(cc, "focus_settings", fs)
    setp(cam, "auto_activate_for_player", unreal.AutoReceiveInput.PLAYER0)

    # Screenshot capture parked at the eye: -RenderOffscreen never reads the game viewport back, so the benchmark
    # driver switches this on to grab the player's view (Scripts/bench_game.py).
    shot = EAS.spawn_actor_from_class(unreal.SceneCapture2D, unreal.Vector(*eye), unreal.Rotator(0, -27, 0))
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
        "bloom_intensity": 0.25, "vignette_intensity": 0.45, "film_grain_intensity": 0.12,
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
    if n < 100:  # room + table + 33 chess meshes + props + lights: anything far below means the build went wrong
        raise RuntimeError(f"only {n} actors in the saved level")
    log("BUILD OK", level_path, n, "actors")


try:
    build()
except Exception:
    log("BUILD FAILED\n" + traceback.format_exc())
finally:
    if os.environ.get("TC_QUIT", "1") == "1":
        unreal.SystemLibrary.quit_editor()
