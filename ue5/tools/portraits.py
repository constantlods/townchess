"""Crop and grade the in-game headshots (ue5/tools/win/portraits.ps1) into HUD portraits.

    tools/.venv/bin/python ue5/tools/portraits.py <shot_dir> [--out ue5/assets/ui]

Centre square crop around the face, 256 px, a little lifted and desaturated towards the reference's portrait tiles,
a soft dark vignette so the tile sits in the card. Writes T_Portrait_<id>.png.
"""
import argparse, glob, os

import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("shots")
ap.add_argument("--out", default="ue5/assets/ui")
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
for f in sorted(glob.glob(os.path.join(a.shots, "portrait_*.png"))):
    oid = os.path.basename(f)[len("portrait_"):-4]
    im = Image.open(f).convert("RGB")
    w, h = im.size
    s = int(h * 0.82)
    x0, y0 = (w - s) // 2, int(h * 0.05)
    im = im.crop((x0, y0, x0 + s, y0 + s)).resize((256, 256), Image.LANCZOS)
    x = np.asarray(im).astype(float) / 255.0
    lum = x @ [0.2126, 0.7152, 0.0722]
    x = lum[..., None] + (x - lum[..., None]) * 0.75             # desaturate a little
    x = np.clip(x * 1.25 + 0.02, 0, 1) ** 0.9                    # lift: the lamp-lit face reads at 62 px
    yy, xx = np.mgrid[0:256, 0:256] / 255.0 - 0.5
    x *= (1 - 0.55 * np.clip((np.hypot(xx, yy) - 0.28) / 0.35, 0, 1) ** 1.5)[..., None]
    Image.fromarray((x * 255).round().astype(np.uint8)).save(os.path.join(a.out, f"T_Portrait_{oid}.png"))
    print("portrait", oid)
