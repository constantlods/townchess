"""Bakes the chessboard's playing surface (our own composite of CC0 Poly Haven scans).

    tools/.venv/bin/python ue5/tools/textures/board.py [--res 4096] [--out ue5/assets/textures/board]

8 x 8 squares on a 0..1 UV square (the Blender board maps its playing grid that way; a1 = u,v near 0 is dark):
light squares from white_maple_veneer, dark from dark_wood (Poly Haven, CC0), each square cut from a different
place of the scan so no two share grain, thin dark seams with a slight bevel in the normal map, worn and darkened
square edges, handling grime concentrated in the centre ranks. Writes BaseColor, Normal (DirectX) and ARM.
"""
import argparse
import io
import os
import urllib.request

import numpy as np
from PIL import Image
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument("--res", type=int, default=4096)
ap.add_argument("--out", default="ue5/assets/textures/board")
ap.add_argument("--cache", default="tools/.cache/polyhaven")
ap.add_argument("--seed", type=int, default=7)
ap.add_argument("--dirt", type=float, default=1.0, help="0 = the pass-27 clean board")
a = ap.parse_args()
rng = np.random.default_rng(a.seed)
N, R = 8, a.res
S = R // N


def fetch(slug, kind, res="4k"):
    """Poly Haven map (Diffuse, nor_dx, arm) as float32 HxWxC in 0..1, cached."""
    os.makedirs(a.cache, exist_ok=True)
    path = os.path.join(a.cache, f"{slug}_{kind}_{res}.png")
    if not os.path.exists(path):
        import json
        files = json.load(urllib.request.urlopen(urllib.request.Request(f"https://api.polyhaven.com/files/{slug}", headers={"User-Agent": "townchess"})))
        entry = files[kind][res]
        url = (entry.get("png") or entry.get("jpg"))["url"]
        data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "townchess"})).read()
        Image.open(io.BytesIO(data)).convert("RGB").save(path)
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0


woods = {"light": {k: fetch("white_maple_veneer", k) for k in ("Diffuse", "nor_dx", "arm")},
         "dark": {k: fetch("dark_wood", k) for k in ("Diffuse", "nor_dx", "arm")}}
tint = {"light": np.array([0.93, 0.80, 0.62]), "dark": np.array([0.55, 0.38, 0.26])}

bc = np.zeros((R, R, 3), np.float32)
nm = np.zeros((R, R, 3), np.float32)
arm = np.zeros((R, R, 3), np.float32)
for fy in range(N):          # v (rank direction in UV)
    for fx in range(N):      # u
        kind = "dark" if (fx + fy) % 2 == 0 else "light"   # a1 (0,0) dark
        src = woods[kind]
        h, w, _ = src["Diffuse"].shape
        oy, ox = rng.integers(0, h - S), rng.integers(0, w - S)
        flip = rng.random() < 0.5
        y0 = R - (fy + 1) * S  # image rows run top-down, v runs bottom-up
        for name, dst in (("Diffuse", bc), ("nor_dx", nm), ("arm", arm)):
            tile = src[name][oy:oy + S, ox:ox + S]
            if flip:
                tile = tile[::-1, ::-1]
                if name == "nor_dx":
                    tile = tile.copy(); tile[..., :2] = 1.0 - tile[..., :2]  # 180-degree turn of a tangent-space normal
            dst[y0:y0 + S, fx * S:(fx + 1) * S] = tile
        bc[y0:y0 + S, fx * S:(fx + 1) * S] *= tint[kind] * rng.uniform(0.9, 1.08)

# seams: distance to the nearest square edge (pixels)
yy, xx = np.mgrid[0:R, 0:R]
d = np.minimum(np.minimum(xx % S, S - 1 - xx % S), np.minimum(yy % S, S - 1 - yy % S)).astype(np.float32)
seam = np.clip(d / (R / 1024 * 2.5), 0, 1)                      # ~2.5 px at 1024: a thin dark joint
edge_wear = np.clip(d / (S * 0.12), 0, 1) ** 0.6                 # square edges worn darker and duller
bc *= (0.35 + 0.65 * seam)[..., None]
bc *= (0.86 + 0.14 * edge_wear)[..., None]
# bevel the joint in the normal map: slope towards the seam
gy, gx = np.gradient(ndimage.gaussian_filter(seam, R / 2048))
nm[..., 0] = np.clip(nm[..., 0] - gx * 3.0, 0, 1)
nm[..., 1] = np.clip(nm[..., 1] + gy * 3.0, 0, 1)
# handling grime: worn centre ranks (pieces dragged over them for years), low-frequency blotches
blot = ndimage.gaussian_filter(rng.random((R // 64, R // 64)), 1.2)
blot = np.kron(blot, np.ones((64, 64)))[:R, :R]
blot = ndimage.gaussian_filter(blot, R / 160)
centre = np.exp(-(((yy - R / 2) / (R * 0.32)) ** 2 + ((xx - R / 2) / (R * 0.45)) ** 2))
grime = np.clip((blot - blot.mean()) * 4 + centre * 0.4, 0, 1)
# fine scratches: short random strokes along the grain, lighter on dark wood, darker on light wood
scr = np.zeros((R, R), np.float32)
for _ in range(1400):
    x, y, L = rng.integers(0, R), rng.integers(0, R), rng.integers(R // 200, R // 40)
    ang = rng.normal(0, 0.35)
    xs = np.clip((x + np.cos(ang) * np.arange(L)).astype(int), 0, R - 1)
    ys = np.clip((y + np.sin(ang) * np.arange(L)).astype(int), 0, R - 1)
    scr[ys, xs] = rng.uniform(0.3, 1.0)
scr = ndimage.gaussian_filter(scr, 0.6)
bc *= (1 - 0.16 * grime)[..., None] * np.array([1.0, 0.97, 0.92])
if a.dirt > 0:
    # pass 55: the reference's board is filthy (mottled grey-brown grime, specks, dirt packed into the grain); ours read as
    # clean veneer and its fine detail was half the reference's in the board band. Multi-scale grime, specks, pits.
    def noise(scale):
        n = ndimage.gaussian_filter(rng.standard_normal((R, R)).astype(np.float32), scale / 2.5)
        return (n - n.mean()) / (n.std() + 1e-6)
    mott = 0.5 * noise(96) + 0.35 * noise(24) + 0.25 * noise(6)
    mott = np.clip(mott * 0.45 + 0.1 + grime * 0.5, 0, 1) * a.dirt
    lightsq = np.zeros((R, R), np.float32)
    for fy in range(N):
        for fx in range(N):
            if (fx + fy) % 2:
                lightsq[R - (fy + 1) * S:R - fy * S, fx * S:(fx + 1) * S] = 1
    grey = bc.mean(2, keepdims=True) * np.array([0.78, 0.7, 0.6], np.float32)    # grime is grey-brown, not orange
    bc = bc * (1 - (0.55 * mott * (0.5 + 0.5 * lightsq))[..., None]) + grey * (0.25 * mott * lightsq)[..., None]
    lum = bc.mean(2)
    grain = lum - ndimage.gaussian_filter(lum, 3)                                  # dirt packed into the open grain
    bc *= (1 + np.clip(grain, -0.2, 0.0) * 2.5 * a.dirt * lightsq)[..., None]
    pr = 0.0009 * a.dirt * (0.2 + 1.6 * mott)                                     # specks cluster in the grime
    specks = np.clip(ndimage.gaussian_filter((rng.random((R, R)) < pr).astype(np.float32), 0.8) * 5, 0, 1) \
        + np.clip(ndimage.gaussian_filter((rng.random((R, R)) < pr * 0.15).astype(np.float32), 2.2) * 14, 0, 1)
    bc *= (1 - 0.5 * np.clip(specks, 0, 1) * rng.uniform(0.6, 1.0, (R, R)).astype(np.float32))[..., None]
    bc += (0.05 * mott * (1 - lightsq))[..., None] * np.array([0.9, 0.85, 0.8], np.float32)  # dust and scuffs on the dark squares
    pits = np.clip(ndimage.gaussian_filter((rng.random((R, R)) < 0.0012 * a.dirt).astype(np.float32), 1.6) * 9, 0, 1)
    py, px = np.gradient(pits)
    nm[..., 0] = np.clip(nm[..., 0] + px * 2.0, 0, 1)
    nm[..., 1] = np.clip(nm[..., 1] - py * 2.0, 0, 1)
    arm[..., 1] = np.clip(arm[..., 1] + 0.2 * mott, 0, 1)
bc = bc * (1 - 0.25 * scr[..., None]) + 0.06 * scr[..., None]
arm[..., 1] = np.clip(arm[..., 1] + 0.18 * grime + 0.25 * (1 - seam), 0, 1)   # grime and joints are matte
arm[..., 0] *= (0.6 + 0.4 * seam)                                             # AO in the joints

os.makedirs(a.out, exist_ok=True)
for name, img in (("T_Board_BaseColor", bc), ("T_Board_Normal", nm), ("T_Board_ARM", arm)):
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(a.out, name + ".jpg"), quality=94, subsampling=0)
    print("wrote", name, img.shape)
