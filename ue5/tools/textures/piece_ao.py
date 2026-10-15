"""Ambient-occlusion / cavity maps for the Poly Haven chess pieces (C6, rook-crown specks, BETA V5).

The scan ships diffuse, normal and roughness maps but no AO, so the master material's AO input was 1.0 on the pieces:
the 3-4 px concave pocket inside each rook crown received full Lumen bounce and specular, and at the game FOV it
sparkled grey/white (C4-rook-diagnosis.jpg). This bakes a short-range AO (2.5 cm rays) per piece kind into the pieces'
own UV atlas, written as an ARM texture for M_TC_PBR (R = AO, G = 160 like the default ARM, B = 0 metal), so Lumen
occludes the pockets and the CavityDarken / CavityRough / CavitySpec parameters can darken and dull them.

Run in Blender (Cycles, CPU), from the chess_set FBX that fetch_polyhaven.py downloaded (CC0, polyhaven.com/a/chess_set):
    blender -b --factory-startup -P ue5/tools/textures/piece_ao.py -- <chess_set_2k.fbx> <out_dir> [size] [samples]
Writes <out_dir>/T_PiecesWhite_ARM.png and T_PiecesBlack_ARM.png (commit them to ue5/assets/textures/pieces/).

Every piece kind's islands share one atlas (each kind's islands are disjoint from the others'); the 8 pawns, 2 rooks, ...
of one colour reuse the same UVs. So one instance per kind is baked, alone (all other objects hidden from render), into
the same image without clearing it. The FBX operator does not register its file properties under Blender 5.0 with the
distro's Python 3.14, so the importer's load() is called directly; it needs numpy (set TC_PYPATH to a site-packages
that has it if Blender's Python does not).
"""
import os
import sys

if os.environ.get("TC_PYPATH"):
    sys.path.append(os.environ["TC_PYPATH"])
import bpy  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
FBX = argv[0]
OUT = argv[1]
SIZE = int(argv[2]) if len(argv) > 2 else 2048
SAMPLES = int(argv[3]) if len(argv) > 3 else 128
AO_DIST = 0.025  # metres (a rook is 3.7 x 6.1 cm): spans the crown floor (1 cm left it open: C6a), short of the board

bpy.ops.wm.read_factory_settings(use_empty=True)
from io_scene_fbx import import_fbx  # noqa: E402


class _Op:
    def report(self, kind, msg):
        print("fbx:", kind, msg)


assert import_fbx.load(_Op(), bpy.context, filepath=FBX) == {"FINISHED"}
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
if scene.world is None:
    scene.world = bpy.data.worlds.new("World")
scene.world.light_settings.distance = AO_DIST
bake = scene.render.bake
bake.margin = 8
bake.use_clear = False
bake.target = "IMAGE_TEXTURES"

meshes = [o for o in scene.objects if o.type == "MESH"]
os.makedirs(OUT, exist_ok=True)
for colour in ("white", "black"):
    mat_name = f"chess_set_pieces_{colour}"
    img = bpy.data.images.new(f"AO_{colour}", SIZE, SIZE, alpha=False, float_buffer=True)
    img.generated_color = (1, 1, 1, 1)  # texels no piece covers stay unoccluded
    img.colorspace_settings.name = "Non-Color"
    mat = bpy.data.materials.get(mat_name)
    mat.use_nodes = True
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    for n in mat.node_tree.nodes:
        n.select = False
    node.select = True
    mat.node_tree.nodes.active = node
    done = set()
    for o in meshes:
        if not o.name.startswith("piece_") or colour not in o.name:
            continue
        kind = o.name.split("_")[1]
        if kind in done:
            continue
        done.add(kind)
        for m in meshes:
            m.hide_render = m is not o
            m.select_set(m is o)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.bake(type="AO")
        print("baked", colour, kind, o.name, flush=True)
    for m in meshes:
        m.hide_render = False
    # pack: R = AO, G = 160/255 (unused roughness slot, as T_TC_DefaultARM), B = 0 (no metal)
    w, h = img.size
    px = list(img.pixels)
    out = bpy.data.images.new(f"ARM_{colour}", w, h, alpha=False)
    out.colorspace_settings.name = "Non-Color"
    packed = [0.0] * (w * h * 4)
    g = 160.0 / 255.0
    for i in range(w * h):
        packed[4 * i] = px[4 * i]
        packed[4 * i + 1] = g
        packed[4 * i + 3] = 1.0
    out.pixels = packed
    path = os.path.join(OUT, f"T_Pieces{colour.capitalize()}_ARM.png")
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    ao = px[0::4]
    print("wrote", path, "AO mean", round(sum(ao) / len(ao), 3), "min", round(min(ao), 3), flush=True)
