"""Procedural table stains for TownChess (our own work, no third-party data): the non-blood wear of the reference's
table, used as decals through the same material as the blood (build_scene.py blood_decals()).

  ring  a mug/cup ring: a slightly wobbling, broken annulus where the coffee/tea dried at the pinned contact line
        (darker rim, a faint film inside), as left by a wet tin mug base
  scratch  knife scars and scuffs: fine scratches, a few grime-filled gouges with pale fresh-wood rims
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


def scratch(n, seed):
    """Knife scars and scuffs (the reference's near table edge): a few deep gouges packed with dark grime, each a
    continuous cut with a lit and a shaded wall and a thin rim of fresh wood, over a sparse set of fine dirt-filled
    scratches running mostly one way; faded out radially.

    C8 (judge run 6, V5 #10 and the "chalk strokes" of finding 5): the C6 gouges were 48 separate segments, each with
    its own random rim width, so on the dark table only the pale, square-ended rim pieces read: dashed pale lines. And
    260 hairlines, each a pale line round a dark core, made a halo that read as chalk from the seat. Now each gouge is
    one polygon with a smoothly varying width, its rim is thin and continuous, the groove has a lit and a shaded wall,
    and the scratches are 150 mostly dark (grime-filled) lines, a faint pale edge on a third of them."""
    from PIL import ImageDraw, ImageFilter
    rng = np.random.default_rng(seed)
    S = 2 * n
    pale = Image.new("L", (S, S), 0)
    dark = Image.new("L", (S, S), 0)
    dp, dd = ImageDraw.Draw(pale), ImageDraw.Draw(dark)
    for k in range(150):
        cx, cy = rng.uniform(0.15, 0.85, 2) * S
        ang = rng.normal(0.0, 0.2) if k % 6 else rng.uniform(0, np.pi)
        ln = rng.uniform(0.03, 0.16) * S
        dx, dy = np.cos(ang) * ln / 2, np.sin(ang) * ln / 2
        pts = [(cx - dx, cy - dy), (cx + dx * 0.5 + rng.normal(0, 3), cy + dy * 0.5 + rng.normal(0, 3)), (cx + dx, cy + dy)]
        w = int(rng.integers(1, 3))
        if k % 3 == 0:
            dp.line(pts, fill=int(rng.uniform(40, 100)), width=w + 2)
        dd.line(pts, fill=int(rng.uniform(90, 200)), width=w)
    halo = Image.new("L", (S, S), 0)
    lit = Image.new("L", (S, S), 0)
    dh, dl = ImageDraw.Draw(halo), ImageDraw.Draw(lit)
    for k in range(4):
        cx, cy = rng.uniform(0.3, 0.7, 2) * S
        ang = np.pi / 2 + rng.normal(0.0, 0.3)  # along texture y: the long side of the near-edge strips (22 x 7 cm)
        ln = rng.uniform(0.3, 0.5) * S
        wmax = rng.uniform(90, 130)  # px at 2x: 45-65 px of 1024 at the middle
        bend = rng.normal(0, 0.04) * S
        t = np.linspace(0, 1, 161)
        tang = np.array([np.cos(ang), np.sin(ang)])
        nrm = np.array([-np.sin(ang), np.cos(ang)])
        # smooth wobble of the path and of the widths (low-order sines with random phases: continuous, no per-step noise)
        ph = rng.uniform(0, 2 * np.pi, 4)
        wob = bend * np.sin(np.pi * t) + 0.0035 * S * (0.6 * np.sin(2 * np.pi * 1.7 * t + ph[0]) + 0.4 * np.sin(2 * np.pi * 3.1 * t + ph[1]))
        c = np.array([cx, cy])[None] + ((t - 0.5) * ln)[:, None] * tang[None] + wob[:, None] * nrm[None]
        w = wmax * np.sin(np.pi * t) ** 0.55 * (0.85 + 0.15 * np.sin(2 * np.pi * 2.3 * t + ph[2]))
        rimw = w * 1.25 + 7 + 5 * (0.5 + 0.5 * np.sin(2 * np.pi * 4.3 * t + ph[3]))

        def band(h0, h1):
            return [tuple(p) for p in c + h0[:, None] * nrm[None]] + [tuple(p) for p in c + h1[:, None] * nrm[None]][::-1]
        dh.polygon(band(w * 2.2 + 4, -(w * 2.2 + 4)), fill=255)
        dp.polygon(band(rimw / 2, -rimw / 2), fill=255)
        dd.polygon(band(w / 2, -w / 2), fill=255)
        dl.polygon(band(w / 2, w / 8), fill=255)  # the wall that faces the light
    halo = halo.filter(ImageFilter.GaussianBlur(14))
    P = np.asarray(pale.filter(ImageFilter.GaussianBlur(1.2)).resize((n, n), Image.LANCZOS)).astype(np.float64) / 255
    D = np.asarray(dark.filter(ImageFilter.GaussianBlur(1.0)).resize((n, n), Image.LANCZOS)).astype(np.float64) / 255
    H = np.asarray(halo.resize((n, n), Image.LANCZOS)).astype(np.float64) / 255
    Lw = np.asarray(lit.filter(ImageFilter.GaussianBlur(3)).resize((n, n), Image.LANCZOS)).astype(np.float64) / 255 * D
    H = np.clip(H - D, 0, 1) * (0.6 + 0.4 * (fbm(n, seed + 7, beta=1.6, fmin=12) * 0.5 + 0.5))
    x, y = grid(n)
    fade = smoothstep(0.5, 0.25, np.hypot(x, y)) * (0.6 + 0.4 * smoothstep(-0.5, 0.5, fbm(n, seed + 1, beta=2.0, fmin=2)))
    rim = np.clip(P - D, 0, 1)
    hal = H * 0.3 * (1 - rim)
    alpha = np.clip((rim * 0.85 + D * 0.97 + hal) * fade, 0, 1)
    fresh = np.array([0.30, 0.20, 0.11])      # linear: cut wood, greyed by handling
    groove = np.array([0.012, 0.009, 0.006])  # packed grime at the bottom of the cut
    wall = np.array([0.10, 0.065, 0.035])     # the lit wall of the cut
    grime = np.array([0.03, 0.022, 0.014])
    gcol = groove[None, None] * (1 - Lw[..., None]) + wall[None, None] * Lw[..., None]
    tot = np.maximum(rim + D + hal, 1e-6)
    col = (fresh[None, None] * rim[..., None] + gcol * D[..., None] + grime[None, None] * hal[..., None]) / tot[..., None]
    rough = 0.75 + 0.15 * np.clip(D + H, 0, 1)
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
    for k, (name, fn) in enumerate((("Ring", ring), ("Dirt", dirt), ("Scratch", scratch))):
        col, alpha, rough = fn(a.size, a.seed + 50 * k)
        save(col, alpha, rough, os.path.join(d, f"T_Stain_{name}"))
        print("stain", name, f"coverage {alpha.mean():.3f}", flush=True)


if __name__ == "__main__":
    main()
