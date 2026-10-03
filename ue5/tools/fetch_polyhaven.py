"""Fetch CC0 Poly Haven assets for the UE5 benchmark scene.

Models: FBX at the chosen resolution, plus the textures Poly Haven bundles with it.
Textures: base color, DirectX normal, ARM (AO/rough/metal) and displacement as JPG.
Usage: python3 fetch_polyhaven.py <out_dir> [res]
"""
import json, os, sys, urllib.request

MODELS = [
    "chess_set", "desk_lamp_arm_01", "wooden_table_02", "metal_office_desk", "wheelchair_01",
    "mounted_fluorescent_lights", "modular_industrial_pipes_01", "book_encyclopedia_set_01",
    "alarm_clock_01", "binder_notebook", "drawer_cabinet", "painted_wooden_chair_01", "lightbulb_01",
]
TEXTURES = [
    "wood_table_worn", "concrete_floor_worn_001", "painted_plaster_wall", "cracked_concrete_wall",
    "rusty_metal_02", "rough_linen", "brown_leather",
]
TEX_MAPS = {"Diffuse": "diff", "nor_dx": "nor_dx", "arm": "arm", "Displacement": "disp"}


def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "townchess-fetch"})) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    os.replace(tmp, path)


def files(asset):
    with urllib.request.urlopen(urllib.request.Request(f"https://api.polyhaven.com/files/{asset}", headers={"User-Agent": "townchess-fetch"})) as r:
        return json.load(r)


def main():
    out, res = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "2k")
    for m in MODELS:
        fbx = files(m)["fbx"][res]["fbx"]
        base = os.path.join(out, "models", m)
        get(fbx["url"], os.path.join(base, os.path.basename(fbx["url"])))
        for rel, inc in fbx.get("include", {}).items():
            get(inc["url"], os.path.join(base, rel))
        print("model", m, flush=True)
    for t in TEXTURES:
        f = files(t)
        for key, short in TEX_MAPS.items():
            if key in f and res in f[key]:
                fmt = "jpg" if "jpg" in f[key][res] else "png"
                get(f[key][res][fmt]["url"], os.path.join(out, "textures", t, f"{t}_{short}.{fmt}"))
        print("texture", t, flush=True)


if __name__ == "__main__":
    main()
