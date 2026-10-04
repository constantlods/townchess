"""Procedural hero props for TownChess, authored in Blender (our own geometry, no third-party assets).

    blender -b --factory-startup -P ue5/tools/blender/props.py -- <out_dir>

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
    w.thickness = 0.0028
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


def export(name):
    bpy.ops.object.select_all(action="SELECT")
    # OBJ: Debian's Blender ships without the FBX add-on. UE reads OBJ units as centimetres, Y up.
    bpy.ops.wm.obj_export(filepath=f"{OUT}/{name}", export_selected_objects=True, global_scale=100.0,
                          forward_axis="NEGATIVE_Z", up_axis="Y", export_materials=True, export_uv=True,
                          export_normals=True, apply_modifiers=True)
    tris = sum(len(p.vertices) - 2 for o in bpy.context.selected_objects if o.type == "MESH" for p in o.data.polygons)
    print(f"[TCPROPS] wrote {name} tris={tris}", flush=True)


cage_mask()
tin_mug()
