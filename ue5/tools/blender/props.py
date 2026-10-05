"""Procedural hero props for TownChess, authored in Blender (our own geometry, no third-party assets).

    blender -b --factory-startup -P ue5/tools/blender/props.py -- <out_dir> [names...]

Writes OBJ files (centimetres in UE):
  cage_mask.obj  - asylum restraint mask: a welded wire grid over the face, an iron rim band, a centre strap over the
                   brow, a jaw strap and rivets. Origin at the centre of the head; the face points along -Y (Blender
                   front), i.e. towards the player once rotated onto the opponent's head.
  tin_mug.obj    - enamel/tin camp mug with a rolled lip, a strap handle and dents.
"""
import math
import random
import sys

import bmesh
import bpy
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "/tmp"
rnd = random.Random(7)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def obj_from_bm(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def apply_mods(ob):
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    ob.select_set(False)


def material(ob, name):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    ob.data.materials.clear()
    ob.data.materials.append(mat)


def head_point(u, v, rx, ry, rz):
    """u: angle around the head (0 = straight ahead, -Y), v: elevation; an egg-ish head shell with a flatter face."""
    x = rx * math.sin(u) * math.cos(v)
    y = -ry * math.cos(u) * math.cos(v)
    z = rz * math.sin(v)
    if v < 0:  # narrower towards the jaw
        k = 1 + 0.25 * math.sin(v)
        x *= k
        y *= k
    return Vector((x, y, z))


def cage_mask():
    reset()
    rx, ry, rz = 0.098, 0.112, 0.135  # just outside a head (metres)
    du, dv = 10, 9                    # grid cells across / down the face (~2.5 cm openings)
    umax, vmin, vmax = math.radians(78), math.radians(-62), math.radians(58)
    # wire grid: a quad surface, then a wireframe modifier turns every edge into a round-ish welded bar
    bm = bmesh.new()
    verts = []
    for j in range(dv + 1):
        v = vmin + (vmax - vmin) * j / dv
        row = []
        for i in range(du + 1):
            u = -umax + 2 * umax * i / du
            p = head_point(u, v, rx, ry, rz)
            p += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.0012  # hand-welded
            row.append(bm.verts.new(p))
        verts.append(row)
    for j in range(dv):
        for i in range(du):
            bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
    grid = obj_from_bm("Mask_Grid", bm)
    w = grid.modifiers.new("wire", "WIREFRAME")
    w.thickness = 0.0042  # forged iron wire, not thin toy bars (visual judge)
    w.use_even_offset = True
    w.use_replace = True
    bv = grid.modifiers.new("soften", "BEVEL")  # round the bar edges a little; keeps square openings
    bv.width = 0.0006
    bv.segments = 2
    apply_mods(grid)

    def band(name, pts, width, thick):
        """flat iron strap following a polyline on the shell"""
        bm = bmesh.new()
        prev = None
        for k, p in enumerate(pts):
            n = p.normalized()
            t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
            side = n.cross(t).normalized() * width / 2
            a = bm.verts.new(p + n * 0.004 - side)
            b = bm.verts.new(p + n * 0.004 + side)
            if prev:
                bm.faces.new((prev[0], prev[1], b, a))
            prev = (a, b)
        ob = obj_from_bm(name, bm)
        so = ob.modifiers.new("solid", "SOLIDIFY")
        so.thickness = thick
        bv = ob.modifiers.new("bevel", "BEVEL")
        bv.width = 0.0008
        bv.segments = 2
        apply_mods(ob)
        return ob

    steps = 48
    # the rim runs just inside the grid edge so it frames the wires instead of sticking out like a brim
    ue, va, vb = umax - 0.06, vmax - 0.06, vmin + 0.06
    rim = [head_point(-ue + 2 * ue * k / steps, va, rx, ry, rz) for k in range(steps + 1)]
    rim += [head_point(ue, va - (va - vb) * k / steps, rx, ry, rz) for k in range(1, steps + 1)]
    rim += [head_point(ue - 2 * ue * k / steps, vb, rx, ry, rz) for k in range(1, steps + 1)]
    rim += [head_point(-ue, vb + (va - vb) * k / steps, rx, ry, rz) for k in range(1, steps + 1)]
    parts = [grid, band("Mask_Rim", rim, 0.014, 0.0025)]
    parts.append(band("Mask_CentreStrap", [head_point(0, vmin + (vmax + 0.5 - vmin) * k / steps, rx * 1.01, ry * 1.01, rz * 1.01)
                                            for k in range(steps + 1)], 0.022, 0.003))
    parts.append(band("Mask_BrowStrap", [head_point(-umax * 1.9 + 3.8 * umax * k / steps, math.radians(30), rx * 1.02, ry * 1.02, rz * 1.02)
                                          for k in range(steps + 1)], 0.02, 0.003))
    parts.append(band("Mask_JawStrap", [head_point(-umax * 1.6 + 3.2 * umax * k / steps, math.radians(-38), rx * 1.02, ry * 1.02, rz * 1.02)
                                         for k in range(steps + 1)], 0.016, 0.003))
    # rivets where straps cross the rim and each other
    for u, v in ((0, vmax), (0, vmin), (0, math.radians(30)), (0, math.radians(-38)), (-umax, math.radians(30)),
                 (umax, math.radians(30)), (-umax, math.radians(-38)), (umax, math.radians(-38))):
        p = head_point(u, v, rx, ry, rz) * 1.06
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0045, segments=12, ring_count=6, location=p)
        r = bpy.context.active_object
        r.scale = (1, 1, 0.6)
        r.rotation_mode = "QUATERNION"
        r.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(p.normalized())
        parts.append(r)
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    mask = bpy.context.active_object
    mask.name = "SM_CageMask"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth()
    material(mask, "M_CageMask")
    export("cage_mask.obj")


def tin_mug():
    reset()
    r, h = 0.042, 0.095
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r, depth=h, location=(0, 0, h / 2))
    mug = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(mug.data)
    top = [f for f in bm.faces if f.normal.z > 0.9]
    bmesh.ops.delete(bm, geom=top, context="FACES")
    for v in bm.verts:  # dents: a few soft pushes into the wall
        for cx, cz, depth in ((0.6, 0.03, 0.005), (-2.2, 0.06, 0.004), (2.6, 0.075, 0.003)):
            ang = math.atan2(v.co.y, v.co.x)
            d = math.hypot((ang - cx) * r, v.co.z - cz)
            if d < 0.02 and v.co.z > 0.002:
                v.co.xy *= 1 - depth / r * (1 - d / 0.02) ** 2
    bm.to_mesh(mug.data)
    bm.free()
    so = mug.modifiers.new("solid", "SOLIDIFY")
    so.thickness = 0.0015
    so.offset = -1
    sub = mug.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    apply_mods(mug)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.026, minor_radius=0.005, major_segments=32, minor_segments=10,
                                     location=(r + 0.012, 0, h * 0.55), rotation=(math.radians(90), 0, 0))
    handle = bpy.context.active_object
    handle.scale = (0.8, 1.0, 1.25)
    bpy.ops.object.transform_apply(scale=True, rotation=True, location=False)
    bm = bmesh.new()
    bm.from_mesh(handle.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x < -0.012], context="VERTS")  # the half inside the mug
    bm.to_mesh(handle.data)
    bm.free()
    for o in (mug, handle):
        o.select_set(True)
    bpy.context.view_layer.objects.active = mug
    bpy.ops.object.join()
    mug = bpy.context.active_object
    mug.name = "SM_TinMug"
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth()
    material(mug, "M_TinMug")
    export("tin_mug.obj")


def desk_lamp():
    """Dome-shade desk lamp: weighted base, stem, forward arm, brass dome. The bulb centre is BULB (Blender metres,
    arm along +X); build_scene puts the key spot light there."""
    reset()
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.085, depth=0.025, location=(0, 0, 0.0125))
    parts.append(bpy.context.active_object)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.03, depth=0.012, location=(0, 0, 0.031))
    parts.append(bpy.context.active_object)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.009, depth=0.36, location=(0, 0, 0.21))
    parts.append(bpy.context.active_object)
    # arm: a quarter bend from the stem top forward, then straight to the shade
    bpy.ops.curve.primitive_bezier_curve_add()
    arm = bpy.context.active_object
    sp = arm.data.splines[0]
    sp.bezier_points[0].co = (0, 0, 0.385)
    sp.bezier_points[0].handle_right = (0, 0, 0.45)
    sp.bezier_points[0].handle_left = (0, 0, 0.33)
    sp.bezier_points[1].co = (0.2, 0, 0.43)
    sp.bezier_points[1].handle_left = (0.08, 0, 0.47)
    sp.bezier_points[1].handle_right = (0.26, 0, 0.41)
    arm.data.bevel_depth = 0.008
    arm.data.bevel_resolution = 4
    bpy.ops.object.convert(target="MESH")
    parts.append(bpy.context.active_object)
    # dome shade: a hemisphere shell opening downwards, tilted towards the table
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=0.11, location=(0.24, 0, 0.42))
    shade = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(shade.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01], context="VERTS")
    bm.to_mesh(shade.data)
    bm.free()
    so = shade.modifiers.new("solid", "SOLIDIFY")
    so.thickness = 0.002
    apply_mods(shade)
    shade.rotation_euler = (0, math.radians(18), 0)
    parts.append(shade)
    for o in parts:
        material(o, "M_LampMetal")
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.03, location=(0.24, 0, 0.385))
    bulb = bpy.context.active_object
    material(bulb, "M_LampBulb")
    parts.append(bulb)
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    lamp = bpy.context.active_object
    lamp.name = "SM_DomeLamp"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth()
    export("dome_lamp.obj")


# ---------------------------------------------------------------- The Annotator (docs/CHARACTERS.md 2.2, 2.3)

def _mask_width(z):
    """Plate width (cm) at height z (cm, 0 = brow edge, negative downwards, chin at -24)."""
    pts = [(0.0, 15.0), (-9.0, 17.5), (-20.0, 11.0), (-23.2, 6.0), (-24.0, 0.0)]
    for (z0, w0), (z1, w1) in zip(pts, pts[1:]):
        if z1 <= z <= z0:
            t = (z0 - z) / (z0 - z1)
            t = t * t * (3 - 2 * t)
            return w0 + (w1 - w0) * t
    return 0.0


def _plate_y(x, z):
    """Front surface depth (cm, Blender -Y is forward): horizontal radius 11, vertical radius 30, spine most forward."""
    r_h, r_v = 11.0, 30.0
    y = -7.5 + (r_h - math.sqrt(max(r_h * r_h - x * x, 1.0)))
    y += (z + 11.0) ** 2 / (2 * r_v)
    return y


def annotator_mask():
    reset()
    S = 0.01  # cm -> m
    cell = 0.45
    eye_cx, eye_cz = -3.2, -10.0           # viewer-left leaf (wearer's right eye)
    dent_c = (3.2 + 0.8, -10.0 + 0.8)       # blind side
    parts = []

    def leaf(name, x0, x1, push):
        bm = bmesh.new()
        nx, nz = int(round((x1 - x0) / cell)), int(round(24.0 / cell))
        vs = {}
        def v(i, j):
            if (i, j) not in vs:
                x, z = x0 + i * cell, -j * cell
                y = _plate_y(x, z) - push
                dx, dz = x - dent_c[0], z - dent_c[1]
                d = math.hypot(dx, dz)
                if d < 1.25 and x > 0:
                    y += 0.4 * (1 - (d / 1.25) ** 2)       # hammered dent
                y += 0.03 * math.sin(x * 2.1 + z * 1.7)   # hand-formed waviness
                vs[(i, j)] = bm.verts.new((x * S, y * S, (z + 2.0) * S))  # origin at the nasion, 2 cm under the brow
            return vs[(i, j)]
        for j in range(nz):
            for i in range(nx):
                xc, zc = x0 + (i + 0.5) * cell, -(j + 0.5) * cell
                if abs(xc) > _mask_width(zc) / 2:
                    continue
                gi, gj = math.floor((xc - (eye_cx - 1.8)) / cell), math.floor((-(zc) - (-eye_cz - 1.8)) / cell)
                if name == "Leaf_L" and 0 <= gi < 8 and 0 <= gj < 8 and (gi + gj) % 2 == 1:
                    continue  # drilled dark squares: the checker eye opening
                bm.faces.new((v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)))
        ob = obj_from_bm(name, bm)
        so = ob.modifiers.new("solid", "SOLIDIFY")
        so.thickness = 0.002
        apply_mods(ob)
        material(ob, "M_Steel")
        return ob

    parts.append(leaf("Leaf_L", -9.9, 0.9, 0.2))   # overlaps the right leaf by 1.8 cm, sits proud of it
    parts.append(leaf("Leaf_R", -0.9, 9.9, 0.0))

    # rolled bead around the outline
    bpy.ops.curve.primitive_bezier_curve_add()
    cu = bpy.context.active_object
    sp = cu.data.splines[0]
    pts = []
    for k in range(60):
        z = -24.0 * k / 59
        pts.append((_mask_width(z) / 2, z))
    outline = pts + [(-x, z) for x, z in reversed(pts)]
    cu.data.splines.remove(sp)
    poly = cu.data.splines.new("POLY")
    poly.points.add(len(outline) - 1)
    for p, (x, z) in zip(poly.points, outline):
        p.co = (x * S, (_plate_y(x, z) - 0.25) * S, (z + 2.0) * S, 1)
    poly.use_cyclic_u = True
    cu.data.bevel_depth = 0.0025
    cu.data.bevel_resolution = 3
    bpy.ops.object.convert(target="MESH")
    bead = bpy.context.active_object
    material(bead, "M_Steel")
    parts.append(bead)

    def box(name, size, loc, mat, rot=(0, 0, 0)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
        b = bpy.context.active_object
        b.scale = size
        bpy.ops.object.transform_apply(scale=True)
        material(b, mat)
        parts.append(b)
        return b

    def rivet(x, z, d=0.6, h=0.25, proud=0.6):
        y = _plate_y(x, z) - proud
        bpy.ops.mesh.primitive_uv_sphere_add(radius=d / 2 * S, segments=12, ring_count=6, location=(x * S, y * S, (z + 2.0) * S))
        r = bpy.context.active_object
        r.scale = (1, h / (d / 2), 1)
        material(r, "M_Copper")
        parts.append(r)

    # spine strap with nine rivets
    for k in range(23):
        z = -0.5 - k
        box(f"Spine{k}", (1.4 * S, 0.4 * S, 1.35 * S), (0, (_plate_y(0, z) - 0.45) * S, (z + 2.0) * S), "M_Steel")
    for k in range(9):
        rivet(0.0, -1.6 - k * 2.6, proud=0.75)
    # repair patch, viewer-right lower cheek, six rivets with one missing
    pz, px = -15.0, 3.4
    box("Patch", (4.0 * S, 0.15 * S, 6.0 * S), (px * S, (_plate_y(px, pz) - 0.12) * S, (pz + 2.0) * S), "M_Steel", rot=(0, math.radians(8), 0))
    for k, (dx, dz) in enumerate(((-1.6, 1.8), (1.6, 1.8), (-1.6, -1.8), (1.6, -1.8), (0, 2.7), (0, -2.7))):
        if k != 3:
            rivet(px + dx, pz + dz, d=0.4, h=0.18, proud=0.3)
    # temple tabs and the head band (over the coif)
    for sx in (-1, 1):
        x = sx * 8.2
        box(f"Tab{sx}", (2.5 * S, 0.3 * S, 4.0 * S), (x * S, (_plate_y(x, -3) + 0.6) * S, (-3 + 2.0) * S), "M_Steel", rot=(0, 0, math.radians(-sx * 55)))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.092, minor_radius=0.004, major_segments=64, minor_segments=8,
                                     location=(0, 0.035, 0.005))
    band = bpy.context.active_object
    band.scale = (0.87, 1.08, 2.6)
    bpy.ops.object.transform_apply(scale=True)
    material(band, "M_Steel")
    parts.append(band)
    # dark pupil plane behind the eye grid
    box("Pupil", (3.4 * S, 0.05 * S, 3.4 * S), (eye_cx * S, (_plate_y(eye_cx, eye_cz) + 1.2) * S, (eye_cz + 2.0) * S), "M_Pupil")

    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    m = bpy.context.active_object
    m.name = "SM_AnnotatorMask"
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.005)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth()
    export("annotator_mask.obj")


def annotator_coif():
    """Coarse linen coif covering skull, ears and neck; open where the plate sits. Origin at the nasion."""
    reset()
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=1, location=(0, 0, 0))
    c = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(c.data)
    for v in bm.verts:
        x, y, z = v.co
        v.co = (x * 0.088, y * 0.105 + 0.085, z * 0.12 + 0.03)  # head shell centred ~8.5 cm behind the nasion
    # neck tube below the skull
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.035 and v.co.y < 0.03], context="VERTS")  # open face/jaw front
    bm.to_mesh(c.data)
    bm.free()
    so = c.modifiers.new("solid", "SOLIDIFY")
    so.thickness = 0.003
    apply_mods(c)
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=0.068, depth=0.13, location=(0, 0.085, -0.13))
    neck = bpy.context.active_object
    so = neck.modifiers.new("solid", "SOLIDIFY")
    so.thickness = 0.003
    apply_mods(neck)
    for o in (c, neck):
        material(o, "M_Linen")
        o.select_set(True)
    bpy.context.view_layer.objects.active = c
    bpy.ops.object.join()
    co = bpy.context.active_object
    co.name = "SM_AnnotatorCoif"
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth()
    export("annotator_coif.obj")


def sleeve(name, length, r0, r1, mat, out):
    """Tapered tube along +X from the origin (attach to an arm bone), gathered at both ends."""
    reset()
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=1, depth=1, location=(0, 0, 0), rotation=(0, math.radians(90), 0))
    t = bpy.context.active_object
    bpy.ops.object.transform_apply(rotation=True)
    bm = bmesh.new()
    bm.from_mesh(t.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs(f.normal.x) > 0.9], context="FACES")
    for v in bm.verts:
        u = v.co.x + 0.5
        r = r0 + (r1 - r0) * u
        r *= 1.0 + 0.08 * math.sin(u * math.pi) - 0.1 * (math.exp(-u * 18) + math.exp(-(1 - u) * 18))  # gathered ends
        r *= 1.0 + 0.02 * math.sin(math.atan2(v.co.z, v.co.y) * 5 + u * 9)                              # folds
        a = math.atan2(v.co.z, v.co.y)
        v.co = (u * length, math.cos(a) * r, math.sin(a) * r)
    bm.to_mesh(t.data)
    bm.free()
    so = t.modifiers.new("solid", "SOLIDIFY")
    so.thickness = 0.002
    sub = t.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    apply_mods(t)
    t.name = name
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth()
    material(t, mat)
    export(out)


def ledger():
    """Cloth-bound ledger 27 x 20 x 3 cm, oxblood cover, cream page block, ribbon marker. Origin bottom centre."""
    reset()
    parts = []
    def box(size, loc, mat):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        b = bpy.context.active_object
        b.scale = size
        bpy.ops.object.transform_apply(scale=True)
        bv = b.modifiers.new("bevel", "BEVEL")
        bv.width = 0.0015
        bv.segments = 2
        apply_mods(b)
        material(b, mat)
        parts.append(b)
    box((0.27, 0.20, 0.004), (0, 0, 0.002), "M_LedgerCloth")
    box((0.27, 0.20, 0.004), (0, 0, 0.028), "M_LedgerCloth")
    box((0.006, 0.20, 0.03), (-0.135, 0, 0.015), "M_LedgerCloth")
    box((0.262, 0.192, 0.022), (0.002, 0, 0.015), "M_Pages")
    box((0.008, 0.0015, 0.09), (0.04, -0.1, -0.03), "M_Ribbon")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    l = bpy.context.active_object
    l.name = "SM_Ledger"
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    export("ledger.obj")


def pencil():
    """Hexagonal pencil about 11 cm with a metal ferrule and eraser, along +X."""
    reset()
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.0036, depth=0.095, location=(0.0475, 0, 0), rotation=(0, math.radians(90), 0))
    parts.append(bpy.context.active_object); material(parts[-1], "M_PencilPaint")
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.0036, radius2=0.0006, depth=0.012, location=(-0.006, 0, 0), rotation=(0, math.radians(-90), 0))
    parts.append(bpy.context.active_object); material(parts[-1], "M_PencilWood")
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.0039, depth=0.008, location=(0.099, 0, 0), rotation=(0, math.radians(90), 0))
    parts.append(bpy.context.active_object); material(parts[-1], "M_Ferrule")
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.0035, depth=0.006, location=(0.106, 0, 0), rotation=(0, math.radians(90), 0))
    parts.append(bpy.context.active_object); material(parts[-1], "M_Eraser")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    p = bpy.context.active_object
    p.name = "SM_Pencil"
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    export("pencil.obj")



def clipboard():
    """Hardboard clipboard 23 x 32 cm with a steel spring clip at the top edge. Origin at the board centre, lying in
    the XY plane, top edge towards +Y; the paper is a separate plane drawn by the game (ATCClipboard)."""
    reset()
    parts = []
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    b = bpy.context.active_object
    b.scale = (0.23, 0.32, 0.004)
    bpy.ops.object.transform_apply(scale=True)
    bv = b.modifiers.new("bevel", "BEVEL"); bv.width = 0.012; bv.segments = 6; bv.affect = "VERTICES"
    bv2 = b.modifiers.new("bevel2", "BEVEL"); bv2.width = 0.0008; bv2.segments = 2
    apply_mods(b)
    material(b, "M_Hardboard")
    parts.append(b)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.135, 0.006))
    c = bpy.context.active_object
    c.scale = (0.11, 0.035, 0.008)
    bpy.ops.object.transform_apply(scale=True)
    bv = c.modifiers.new("bevel", "BEVEL"); bv.width = 0.003; bv.segments = 3
    apply_mods(c)
    material(c, "M_ClipSteel")
    parts.append(c)
    for x in (-0.035, 0.035):
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.004, depth=0.012, location=(x, 0.152, 0.012), rotation=(0, math.radians(90), 0))
        r = bpy.context.active_object; material(r, "M_ClipSteel"); parts.append(r)
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    cb = bpy.context.active_object
    cb.name = "SM_Clipboard"
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    export("clipboard.obj")


def med_cart():
    """Two-tier institutional instrument cart, 60 x 40 x 85 cm, tube frame, steel trays with raised lips, castors."""
    reset()
    parts = []
    W, D, H = 0.60, 0.40, 0.85
    for x in (-W / 2 + 0.02, W / 2 - 0.02):
        for y in (-D / 2 + 0.02, D / 2 - 0.02):
            bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.011, depth=H - 0.08, location=(x, y, 0.08 + (H - 0.08) / 2))
            parts.append(bpy.context.active_object); material(parts[-1], "M_CartSteel")
            bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.035, depth=0.025, location=(x, y, 0.035), rotation=(math.radians(90), 0, 0))
            parts.append(bpy.context.active_object); material(parts[-1], "M_Rubber")
    for z in (0.25, H - 0.02):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, z))
        t = bpy.context.active_object
        t.scale = (W, D, 0.012)
        bpy.ops.object.transform_apply(scale=True)
        parts.append(t); material(t, "M_CartSteel")
        for sx, sy, lx, ly in ((0, 1, W, 0.004), (0, -1, W, 0.004), (1, 0, 0.004, D), (-1, 0, 0.004, D)):
            bpy.ops.mesh.primitive_cube_add(size=1, location=(sx * W / 2, sy * D / 2, z + 0.02))
            l = bpy.context.active_object
            l.scale = (lx, ly, 0.04)
            bpy.ops.object.transform_apply(scale=True)
            parts.append(l); material(l, "M_CartSteel")
    bpy.ops.mesh.primitive_torus_add(major_radius=0.12, minor_radius=0.01, location=(-W / 2 - 0.03, 0, H - 0.05), rotation=(0, math.radians(90), 0))
    h = bpy.context.active_object
    bm = bmesh.new(); bm.from_mesh(h.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x > 0.0], context="VERTS")  # half ring = push handle
    bm.to_mesh(h.data); bm.free()
    parts.append(h); material(h, "M_CartSteel")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    cart = bpy.context.active_object
    cart.name = "SM_MedCart"
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    export("med_cart.obj")



def chess_board():
    """Wooden board matching the game's board actor: 55.3 cm square, 8 x 5.8 cm squares, playing surface at z = 1.71 cm
    (the height the Poly Haven pieces are modelled at). Frame of worn dark wood with a raised lip, brass corner plates
    and domed studs; the playing surface is one 8 x 8 grid UV-mapped 0..1 so the game's material draws the squares."""
    reset()
    S, N = 0.058, 8
    half_play, half_all = S * N / 2, 0.2765
    surf, lip = 0.0171, 0.0192
    parts = []
    def box(name, size, loc, mat, bevel=0.0015):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        b = bpy.context.active_object
        b.scale = size
        bpy.ops.object.transform_apply(scale=True)
        if bevel:
            bv = b.modifiers.new("bevel", "BEVEL"); bv.width = bevel; bv.segments = 3
            apply_mods(b)
        material(b, mat)
        parts.append(b)
        return b
    box("Base", (half_all * 2, half_all * 2, surf - 0.002), (0, 0, (surf - 0.002) / 2), "M_BoardFrame", 0.003)
    w = half_all - half_play
    for sx, sy, lx, ly in ((0, 1, half_all * 2, w), (0, -1, half_all * 2, w), (1, 0, w, half_play * 2), (-1, 0, w, half_play * 2)):
        cx = sx * (half_play + w / 2)
        cy = sy * (half_play + w / 2)
        box("Frame", (lx, ly, lip - (surf - 0.002)), (cx, cy, (surf - 0.002) + (lip - (surf - 0.002)) / 2), "M_BoardFrame", 0.0025)
    # playing surface: one subdivided plane, UV 0..1 over the 8 x 8 squares
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=N + 1, y_subdivisions=N + 1, size=half_play * 2, location=(0, 0, surf))
    g = bpy.context.active_object
    me = g.data
    uv = me.uv_layers.active or me.uv_layers.new()
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((co.x + half_play) / (2 * half_play), (co.y + half_play) / (2 * half_play))
    material(g, "M_BoardSquares")
    parts.append(g)
    # brass: corner plates and domed studs along the frame
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("Corner", (0.05, 0.05, 0.0012), (sx * (half_all - 0.025), sy * (half_all - 0.025), lip + 0.0006), "M_Brass", 0.0008)
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0042, segments=16, ring_count=8, location=(sx * (half_all - 0.018), sy * (half_all - 0.018), lip + 0.0012))
            r = bpy.context.active_object; r.scale = (1, 1, 0.45); material(r, "M_Brass"); parts.append(r)
    for k in range(1, 4):
        t = -half_play + k * (half_play * 2) / 4
        for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            x = sx * (half_play + w / 2) if sx else t
            y = sy * (half_play + w / 2) if sy else t
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0032, segments=14, ring_count=7, location=(x, y, lip + 0.0008))
            r = bpy.context.active_object; r.scale = (1, 1, 0.45); material(r, "M_Brass"); parts.append(r)
    # unwrap every part except the playing grid on its own, BEFORE joining (the grid keeps its 0..1 squares mapping)
    for o in parts:
        if o is g:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.005)
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    b = bpy.context.active_object
    b.name = "SM_ChessBoard"
    export("chess_board.obj")


def export(name):
    # UE's OBJ import maps (x, y, z) -> (x, -z, -y) for this export; pre-rotating +90 deg about X makes the result
    # the usual Blender->UE mapping (x, -y, z): Z up, Blender front (-Y) = UE +Y, Blender +X = UE +X
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            o.rotation_euler.x += math.radians(90)
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
    bpy.ops.object.select_all(action="SELECT")
    # OBJ: Debian's Blender ships without the FBX add-on. UE reads OBJ units as centimetres, Y up.
    bpy.ops.wm.obj_export(filepath=f"{OUT}/{name}", export_selected_objects=True, global_scale=100.0,
                          forward_axis="NEGATIVE_Z", up_axis="Y", export_materials=True, export_uv=True,
                          export_normals=True, apply_modifiers=True)
    tris = sum(len(p.vertices) - 2 for o in bpy.context.selected_objects if o.type == "MESH" for p in o.data.polygons)
    print(f"[TCPROPS] wrote {name} tris={tris}", flush=True)


WHICH = sys.argv[sys.argv.index("--") + 2:] if "--" in sys.argv else []
BUILDERS = {
    "cage_mask": cage_mask, "tin_mug": tin_mug, "desk_lamp": desk_lamp,
    "annotator_mask": annotator_mask, "annotator_coif": annotator_coif, "ledger": ledger, "pencil": pencil,
    "oversleeve": lambda: sleeve("SM_Oversleeve", 0.24, 0.042, 0.034, "M_Duck", "oversleeve.obj"),
    "clipboard": clipboard, "med_cart": med_cart, "chess_board": chess_board,
    "coat_sleeve": lambda: sleeve("SM_CoatSleeve", 0.29, 0.055, 0.046, "M_CoatWool", "coat_sleeve.obj"),
}
for k, f in BUILDERS.items():
    if not WHICH or k in WHICH:
        f()
