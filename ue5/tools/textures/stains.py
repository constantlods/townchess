"""Procedural table stains for TownChess (our own work, no third-party data): the non-blood wear of the reference's
table, used as decals through the same material as the blood (build_scene.py blood_decals()).

  ring  a mug/cup ring: a slightly wobbling, broken annulus where the coffee/tea dried at the pinned contact line
        (darker rim, a faint film inside), as left by a wet tin mug base
  dirt  a handled-grime patch: a soft blotch of dark greasy dirt with anisotropic streaks (wiped, never cleaned),
        fading out radially so it never shows a decal edge

Outputs (1024x1024 PNG unless --size) in <out>/stains/: T_Stain_<Variant>_BaseColor.png (RGBA, alpha = coverage),
_Normal.png (flat but valid), _Roughness.png.

Usage: tools/.venv/bin/python ue5/tools/textures/stains.py [--out ue5/assets/textures] [--size 1024] [--seed 11]
"""
import argparse, os

import numpy as np
from PIL import Image

from blood import fbm, smoothstep, to_srgb

COFFEE_RIM = np.array([0.050, 0.026, 0.012])   # linear: dried coffee/tea rim
COFFEE_FILM = np.array([0.120, 0.075, 0.040])  # thin tea film
DIRT = np.array([0.022, 0.018, 0.013])         # greasy handled grime


def grid(n):
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    return (x - n / 2) / n, (y - n / 2) / n


def ring(n, seed):
    x, y = grid(n)
    r, ang = np.hypot(x, y), np.arctan2(y, x)
    wob = fbm(n, seed, beta=2.4, fmin=2) * 0.012
    r0 = 0.33 + wob + 0.006 * np.sin(3 * ang + seed)
    width = 0.010 + 0.006 * (fbm(n, seed + 1, beta=2.0, fmin=3) * 0.5 + 0.5)
    d = np.abs(r - r0)
    rim = np.exp(-(d / width) ** 2)
    # broken where the mug was lifted at an angle: a gap of ~70 degrees with ragged ends
    gap_c = (seed * 1.37) % (2 * np.pi) - np.pi
    gd = np.abs(np.angle(np.exp(1j * (ang - gap_c))))
    rim *= smoothstep(0.45, 0.8, gd + 0.12 * fbm(n, seed + 2, beta=2.0, fmin=6))
    inside = smoothstep(r0 + 0.004, r0 - 0.02, r) * 0.14 * (0.6 + 0.4 * fbm(n, seed + 3, beta=1.8, fmin=4))
    alpha = np.clip(rim * 0.8 + inside, 0, 1)
    col = COFFEE_FILM[None, None] + (COFFEE_RIM - COFFEE_FILM)[None, None] * np.clip(rim, 0, 1)[..., None]
    rough = 0.55 - 0.15 * rim
    return col, alpha, rough


def dirt(n, seed):
    x, y = grid(n)
    r = np.hypot(x * 1.2, y)
    blot = fbm(n, seed, beta=2.2, fmin=2) * 0.5 + 0.5
    streak = fbm(n, seed + 1, beta=1.6, fmin=3, aniso=6.0) * 0.5 + 0.5  # wiped in one direction
    m = smoothstep(0.42, 0.75, blot * 0.75 + streak * 0.35) * smoothstep(0.5, 0.2, r)
    alpha = np.clip(m * 0.6, 0, 1)
    col = DIRT[None, None] * (0.85 + 0.3 * streak[..., None])
    rough = 0.45 + 0.3 * (1 - m)  # greasy: a little glossier where thick
    return col, alpha, rough


def save(col, alpha, rough, base):
    rgb = (to_srgb(np.clip(col, 0, 1)) * 255).round()
    Image.fromarray(np.dstack([rgb, alpha * 255]).round().clip(0, 255).astype(np.uint8), "RGBA").save(base + "_BaseColor.png")
    flat = np.zeros(alpha.shape + (3,), np.uint8); flat[...] = (128, 128, 255)
    Image.fromarray(flat, "RGB").save(base + "_Normal.png")
    Image.fromarray((np.clip(rough, 0, 1) * 255).round().astype(np.uint8), "L").save(base + "_Roughness.png")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(here, "..", "..", "assets", "textures"))
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--seed", type=int, default=11)
    a = ap.parse_args()
    d = os.path.join(a.out, "stains")
    os.makedirs(d, exist_ok=True)
    for k, (name, fn) in enumerate((("Ring", ring), ("Dirt", dirt))):
        col, alpha, rough = fn(a.size, a.seed + 50 * k)
        save(col, alpha, rough, os.path.join(d, f"T_Stain_{name}"))
        print("stain", name, f"coverage {alpha.mean():.3f}", flush=True)


if __name__ == "__main__":
    main()
