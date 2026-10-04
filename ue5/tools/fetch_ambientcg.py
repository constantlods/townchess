"""Fetch CC0 ambientCG detail layers and decals for the UE5 scene (sibling of fetch_polyhaven.py).

Each asset is a zip (Color/NormalDX/Roughness/Opacity/Displacement maps plus Blender/USD files we do not need);
only the texture maps are extracted, into <out_dir>/ambientcg/<AssetId>/<AssetId>_<Map>.<ext> (the resolution is
dropped from the file name so build scripts do not depend on it). Idempotent: an asset whose folder already holds
its .res marker at the wanted resolution is skipped; partial downloads go to .part files.
Usage: python3 fetch_ambientcg.py <out_dir>        (e.g. C:\\TownChess\\assets\\polyhaven, next to Poly Haven's)
See docs/FREE_ASSETS.md for why each asset was picked and where it goes.
"""
import json, os, sys, urllib.request, zipfile

# AssetId -> preferred resolution ("4K"); falls back to the largest JPG at or below it
ASSETS = {
    "Scratches003": "4K",             # mixed fine + long scratches: piece lacquer and board roughness/normal detail
    "Scratches005": "4K",             # dense directional scratches: table top and board edge wear
    "SurfaceImperfections013": "4K",  # chips and flecks: lacquer chipping mask for the pieces
    "SurfaceImperfections003": "4K",  # vertical streaky grunge: table and wall dirt
    "SurfaceImperfections008": "4K",  # broad smudges: hands-on wear on the board and pieces
    "Fingerprints002": "4K",          # dense fingerprints: piece and clipboard roughness break-up
    "Smear005": "4K",                 # drag strokes (masked): reference for smeared blood on the board
    "Leaking004": "4K",               # vertical streak decal: grime runs on walls / table legs
    "Leaking006": "4K",               # single drip-run decal: rust/blood run under the table edge
    "Rust009": "4K",                  # rust material for the lamp, cart, bed frame
}
RES_ORDER = ["1K", "2K", "4K", "8K", "12K", "16K"]
MAP_SUFFIXES = ("_Color", "_NormalDX", "_Roughness", "_Opacity", "_Displacement", "_AmbientOcclusion", "_Metalness")
UA = {"User-Agent": "townchess-fetch"}


def api(ids):
    url = "https://ambientcg.com/api/v2/full_json?include=downloadData&id=" + ",".join(ids)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r:
        return {a["assetId"]: a for a in json.load(r)["foundAssets"]}


def pick(asset, want):
    """The JPG download at `want`, else the largest one below it."""
    dls = [x for f in asset["downloadFolders"].values() for c in f["downloadFiletypeCategories"].values()
           for x in c["downloads"] if x["attribute"].endswith("-JPG")]
    by_res = {x["attribute"].split("-")[0]: x for x in dls}
    for r in reversed(RES_ORDER[:RES_ORDER.index(want) + 1]):
        if r in by_res:
            return r, by_res[r]
    return None, None


def fetch(out, aid, asset, want):
    res, dl = pick(asset, want)
    if not dl:
        print("ambientcg", aid, "no JPG download", flush=True)
        return
    d = os.path.join(out, "ambientcg", aid)
    marker = os.path.join(d, ".res")
    if os.path.exists(marker) and open(marker).read().strip() == res:
        print("ambientcg", aid, res, "(exists)", flush=True)
        return
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, dl["fileName"] + ".part")
    with urllib.request.urlopen(urllib.request.Request(dl["downloadLink"], headers=UA)) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    with zipfile.ZipFile(tmp) as z:
        for n in z.namelist():
            stem, ext = os.path.splitext(os.path.basename(n))
            if ext.lower() not in (".jpg", ".png"):
                continue
            suffix = next((s for s in MAP_SUFFIXES if stem.endswith(s)), None)
            if not suffix:
                continue  # the preview .png and anything else that is not a map
            with z.open(n) as src, open(os.path.join(d, f"{aid}{suffix}{ext.lower()}"), "wb") as dst:
                dst.write(src.read())
    os.remove(tmp)
    with open(marker, "w") as m:
        m.write(res)
    print("ambientcg", aid, res, flush=True)


def main():
    out = sys.argv[1]
    found = api(list(ASSETS))
    for aid, want in ASSETS.items():
        if aid not in found:
            print("ambientcg", aid, "not found in the API", flush=True)
            continue
        fetch(out, aid, found[aid], want)


if __name__ == "__main__":
    main()
