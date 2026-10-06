# Dump the MetaHuman body (FBX from ue5/TownChess/Scripts/export_body.py) for ue5/tools/textures/skin.py:
#   blender -b -P ue5/tools/blender/dump_mesh.py -- SKM_Body.fbx outdir
# Raw float32/int32 arrays: rest-pose positions, normals, loop UVs, triangles, dominant bone per vertex (LOD0).
# The packaged Blender 5.0.1 has no numpy (its FBX importer needs it: unzip a cp314 numpy wheel into
# $TC_BLENDER_PYLIB, default ~/rs/pylib) and its FBX operator fails ("no attribute files"), so the importer module is
# called directly.
import sys, os
sys.path.insert(0, os.environ.get("TC_BLENDER_PYLIB", os.path.expanduser("~/rs/pylib")))
import json, bpy
from array import array
import io_scene_fbx.import_fbx as IF

a = sys.argv[sys.argv.index("--") + 1:]
os.makedirs(a[1], exist_ok=True)
for x in list(bpy.data.objects):
    bpy.data.objects.remove(x)


class _Op:
    def report(self, *x):
        print("fbx:", x)


print(IF.load(_Op(), bpy.context, filepath=os.path.abspath(a[0])))
mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
print("meshes", [(o.name, len(o.data.vertices)) for o in mesh_objs])
o = max(mesh_objs, key=lambda o: len(o.data.vertices))
me = o.data
me.calc_loop_triangles()
M = o.matrix_world
co = array("f"); nrm = array("f"); dom = array("i")
for v in me.vertices:
    co.extend((M @ v.co)[:]); nrm.extend(v.normal[:])
    dom.append(max(v.groups, key=lambda g: g.weight).group if v.groups else -1)
tv = array("i"); tl = array("i")
for t in me.loop_triangles:
    tv.extend(t.vertices[:]); tl.extend(t.loops[:])
uv = array("f")
for d in me.uv_layers[0].data:
    uv.extend(d.uv[:])
for n, arr in (("co", co), ("nrm", nrm), ("dom", dom), ("tri_v", tv), ("tri_l", tl), ("uv", uv)):
    with open(os.path.join(a[1], n + ".bin"), "wb") as f:
        arr.tofile(f)
json.dump([g.name for g in o.vertex_groups], open(os.path.join(a[1], "groups.json"), "w"))
print("dumped", o.name, len(me.vertices), len(me.loop_triangles))
