"""Wristwatch dial for the player's watch (our own work; the numerals use the repo's OFL Courier Prime).

An aged field-watch dial: yellowed cream with patina blotches toward the rim, a printed minute track, twelve baton
indices with 12/3/6/9 numerals, a small seconds sub-dial, blued hands at 10:08 and a grimy edge. 12 o'clock is the
image top. Output: <out>/watch/T_WatchDial_BaseColor.png (512 x 512, sRGB).

Usage: tools/.venv/bin/python ue5/tools/textures/watch.py [--out ue5/assets/textures]
"""
import argparse
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from blood import fbm

N = 512


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(here, "..", "..", "assets", "textures"))
    a = ap.parse_args()
    c = N / 2
    y, x = np.mgrid[0:N, 0:N]
    r = np.hypot(x - c, y - c) / c
    tone = fbm(N, 5, beta=2.4, fmin=1, shape=(N, N)) * 0.5 + 0.5
    age = 0.35 + 0.35 * tone + 0.5 * np.clip(r - 0.6, 0, 1)
    base = np.array([214, 200, 165], float)[None, None] - age[..., None] * np.array([40, 48, 62], float)
    spots = fbm(N, 6, beta=1.2, fmin=30, shape=(N, N))
    base -= (np.clip(spots - 2.0, 0, 1) * 60)[..., None] * np.array([0.6, 0.8, 1.0])
    base[r > 0.97] = (40, 34, 28)  # the bezel shadow at the rim
    img = Image.fromarray(base.clip(0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img)
    ink = (28, 24, 20)

    def at(rr, ang):  # ang 0 = 12 o'clock, clockwise
        return c + rr * c * math.sin(ang), c - rr * c * math.cos(ang)

    for m in range(60):  # minute track (the hour batons below cover every fifth)
        if m % 5:
            ang = m / 60 * math.tau
            d.line([at(0.9, ang), at(0.85, ang)], fill=ink, width=2)
    for h in range(12):
        ang = h / 12 * math.tau
        d.line([at(0.88, ang), at(0.7, ang)], fill=ink, width=12 if h % 3 == 0 else 8)
    font = ImageFont.truetype(os.path.join(here, "..", "..", "assets", "fonts", "CourierPrime-Bold.ttf"), 56)
    for h, txt in ((0, "12"), (3, "3"), (9, "9")):  # the seconds sub-dial sits at 6
        d.text(at(0.53, h / 12 * math.tau), txt, font=font, fill=ink, anchor="mm")
    # small seconds above 6
    sc = (c, c + 0.32 * c)
    d.ellipse([sc[0] - 44, sc[1] - 44, sc[0] + 44, sc[1] + 44], outline=ink, width=3)
    d.line([sc, (sc[0] + 30, sc[1] - 22)], fill=ink, width=3)
    # hands at 10:08: dark blued steel, a lumed tip on each
    blue = (24, 30, 44)
    for ang, length, width in (((10 + 8 / 60) / 12 * math.tau, 0.5, 16), (8 / 60 * math.tau, 0.78, 11)):
        tip = at(length, ang)
        back = at(-0.12, ang)
        d.line([back, tip], fill=blue, width=width)
        d.line([at(length - 0.16, ang), at(length - 0.04, ang)], fill=(150, 140, 100), width=max(width - 6, 4))
    d.ellipse([c - 14, c - 14, c + 14, c + 14], fill=blue)
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    out = os.path.join(a.out, "watch")
    os.makedirs(out, exist_ok=True)
    img.save(os.path.join(out, "T_WatchDial_BaseColor.png"), optimize=True)
    print("wrote", os.path.join(out, "T_WatchDial_BaseColor.png"))


if __name__ == "__main__":
    main()
