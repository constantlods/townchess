"""Fetch CC0 Poly Haven assets for the UE5 benchmark scene.

Models: FBX at the chosen resolution, plus the textures Poly Haven bundles with it.
Textures: base color, DirectX normal, ARM (AO/rough/metal) and displacement as JPG.
Hero textures (docs/FREE_ASSETS.md) are fetched at a fixed resolution regardless of [res]: the two board woods at
8K (falling back to 4K when 8K is missing), the worn table top, piece lacquer and rust at 4K. A hero texture
already on disk at a lower resolution is replaced once (a .res marker in its folder records what was fetched).
Usage: python3 fetch_polyhaven.py <out_dir> [res]
"""
import json, os, sys, urllib.request

MODELS = [
    "chess_set", "desk_lamp_arm_01", "wooden_table_02", "metal_office_desk", "wheelchair_01",
    "mounted_fluorescent_lights", "modular_industrial_pipes_01", "book_encyclopedia_set_01",
    "alarm_clock_01", "binder_notebook", "drawer_cabinet", "painted_wooden_chair_01", "lightbulb_01",
    "old_bed_frame",
    # table clutter after the reference (pass 48): old books, medical tape, cigarettes, a magnifying glass
    "medical_tape", "cigarette_pack",
]
TEXTURES = [
    "wood_table_worn", "concrete_floor_worn_001", "painted_plaster_wall", "cracked_concrete_wall",
    "rusty_metal_02", "rough_linen", "brown_leather",
    "dirty_tiles", "damaged_plaster", "old_linoleum_flooring_01",
]
# Hero surfaces: slug -> preferred resolutions, best first (docs/FREE_ASSETS.md explains each pick).
HERO_TEXTURES = {
    "white_maple_veneer": ("8k", "4k"),      # light board squares (maple/boxwood)
    "dark_wood": ("8k", "4k"),               # dark board squares (walnut), strong figure, tint darker
    "smoke_speckled_veneer": ("8k", "4k"),   # alternative dark square (cooler, near-ebony)
    "wood_table_worn": ("4k",),              # current table top, upgraded from 2k
    "wood_cabinet_worn_long": ("4k",),       # heavily worn, chipped dark finish: table top candidate
    "lacquered_cherry_wood": ("4k",),        # lacquer roughness/normal reference for the pieces
    "rust_coarse_01": ("4k",),               # rust on the lamp, cart and bed frames
}
# hero surfaces closest to the camera get higher resolutions (texture streaming keeps memory bounded)
HERO = {"chess_set": "8k", "wooden_table_02": "4k", "wood_table_worn": "4k", "rusty_metal_02": "4k", "brown_leather": "4k"}
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


def fetch_texture(out, t, wanted):
    """Fetch one texture's maps at the first resolution in `wanted` that Poly Haven has; returns the resolution."""
    f = files(t)
    res = next((r for r in wanted if all(r in f.get(k, {}) for k in ("Diffuse", "nor_dx", "arm"))), None)
    if res is None:
        print("texture", t, "has none of", wanted, flush=True)
        return None
    d = os.path.join(out, "textures", t)
    marker = os.path.join(d, ".res")
    prev = open(marker).read().strip() if os.path.exists(marker) else None
    if prev != res:
        # first hero fetch, or an earlier run at another resolution: drop the old maps (same file names), then
        # record the target so an interrupted run resumes instead of wiping again (get() skips finished files)
        if os.path.isdir(d):
            for n in os.listdir(d):
                os.remove(os.path.join(d, n))
        os.makedirs(d, exist_ok=True)
        with open(marker, "w") as m:
            m.write(res)
    for key, short in TEX_MAPS.items():
        if key in f and res in f[key]:
            fmt = "jpg" if "jpg" in f[key][res] else "png"
            get(f[key][res][fmt]["url"], os.path.join(d, f"{t}_{short}.{fmt}"))
    return res


def main():
    out, res = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "2k")
    for m in MODELS:
        r = HERO.get(m, res)
        fbx = files(m)["fbx"][r]["fbx"]
        base = os.path.join(out, "models", m)
        get(fbx["url"], os.path.join(base, os.path.basename(fbx["url"])))
        for rel, inc in fbx.get("include", {}).items():
            get(inc["url"], os.path.join(base, rel))
        print("model", m, flush=True)
    for t in TEXTURES:
        if t in HERO_TEXTURES:
            continue
        f = files(t)
        for key, short in TEX_MAPS.items():
            if key in f and res in f[key]:
                fmt = "jpg" if "jpg" in f[key][res] else "png"
                get(f[key][res][fmt]["url"], os.path.join(out, "textures", t, f"{t}_{short}.{fmt}"))
        print("texture", t, flush=True)
    for t, wanted in HERO_TEXTURES.items():
        print("hero texture", t, fetch_texture(out, t, wanted), flush=True)


if __name__ == "__main__":
    main()
