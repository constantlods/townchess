"""Wear mask for the player's institutional sleeve (C6; our own procedural work, no third-party data).

The C5 sleeve mesh (ue5/tools/blender/props.py player_sleeve()) has cylindrical UVs: U runs round the arm (U = 0 / 1
underneath at the seam, 0.5 on top), Blender V = u runs along it from the elbow (0) to the rolled cuff (1). The fabric
itself is the tiled rough_linen scan (MI_PlayerSleeve); this mask, sampled once in the mesh's own UVs through
M_TC_PBR's WearMask, says where the canvas is dirty:

  R  grime: the rolled cuff (rubbed on the table, darkest at the frayed edge), the creases on both flanks of each
     compression fold (props.py fold table, weighted like the fold depth: strongest on top), the slack underside and
     the gathered elbow end; broken up by tileable noise so no band reads as painted
  G  stains: a few dried tea/blood blotches with darker rims, most near the cuff and on top (the reference's
     "Institutional Sleeves": pale canvas with brown-red stains)
  B  unused (0)

The OBJ import keeps V as Blender wrote it (C6a capture: a flipped mask put the cuff grime at the elbow), so image row 0
is the elbow end and the last row the cuff.

Output: <out>/sleeve/T_PlayerSleeve_Wear.png (RGB, linear, 1024 x 1024 unless --size).
Usage: tools/.venv/bin/python ue5/tools/textures/sleeve.py [--out ue5/assets/textures] [--size 1024] [--seed 7]
"""
import argparse
import os

import numpy as np
from PIL import Image

from blood import fbm, smoothstep

# props.py player_sleeve(): (u along the sleeve, depth m, width in u, angle of the strongest side)
FOLDS = [(0.06, 0.0035, 0.025, 0.4), (0.15, 0.003, 0.03, 1.9), (0.24, 0.0026, 0.03, 3.6), (0.34, 0.002, 0.035, 0.9),
         (0.52, 0.0012, 0.04, 2.6), (0.68, 0.0018, 0.03, 5.1), (0.79, 0.0026, 0.025, 4.2)]


def wear(n, seed):
    U = (np.arange(n) + 0.5)[None, :] / n * np.ones((n, 1))
    u = (np.arange(n) + 0.5)[:, None] / n * np.ones((1, n))  # along the sleeve; row 0 = elbow, last row = cuff
    a = 2 * np.pi * U - np.pi / 2
    top = 0.55 + 0.45 * np.sin(a)
    under = np.clip(-np.sin(a), 0, None) ** 2
    rng = np.random.default_rng(seed)
    big = fbm(n, seed, beta=2.4, fmin=2)
    mid = fbm(n, seed + 1, beta=1.8, fmin=6, aniso=0.4)  # streaks along the arm
    fine = fbm(n, seed + 2, beta=1.2, fmin=24)

    crease = np.zeros((n, n))
    for fu, depth, w, fa in FOLDS:
        k = depth / 0.0035 * (0.45 + 0.55 * top) * (0.75 + 0.25 * np.cos(a - fa))
        d = np.abs(u - fu)
        crease += k * np.exp(-((d - 0.9 * w) / (0.35 * w)) ** 2)  # dirt in the valleys on both flanks of the ring
    cuff = smoothstep(0.80, 0.90, u) * (0.55 + 0.45 * smoothstep(0.93, 1.0, u))
    elbow = smoothstep(0.08, 0.0, u) * 0.5
    g = 0.95 * cuff + 0.9 * crease + 0.35 * under + elbow
    g = g * (0.65 + 0.35 * np.tanh(big)) + 0.08 * mid + 0.05 * fine
    grime = np.clip(g, 0, 1)

    stain = np.zeros((n, n))
    for k in range(5):
        cu = rng.uniform(0.35, 0.97) if k else 0.9
        cU = rng.uniform(0.3, 0.7) if k % 3 else rng.uniform(0, 1)  # most on top / the sides the camera sees
        r = rng.uniform(0.025, 0.07)
        dU = np.angle(np.exp(2j * np.pi * (U - cU))) / (2 * np.pi) * (31.4 / 20.0)  # wrap round, in sleeve-length units
        dist = np.hypot(dU, u - cu) / r + 0.35 * fbm(n, seed + 10 + k, beta=2.0, fmin=8)
        body = smoothstep(1.0, 0.6, dist)
        rim = np.exp(-((dist - 0.85) / 0.12) ** 2)  # dried edge, darker
        stain = np.maximum(stain, rng.uniform(0.35, 0.6) * body + 0.35 * rim * body.max())
    stain = np.clip(stain * (0.8 + 0.2 * fine), 0, 1)
    return grime, stain


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(here, "..", "..", "assets", "textures"))
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    d = os.path.join(a.out, "sleeve")
    os.makedirs(d, exist_ok=True)
    grime, stain = wear(a.size, a.seed)
    rgb = np.dstack([grime, stain, np.zeros_like(grime)])
    Image.fromarray((rgb * 255).round().astype(np.uint8), "RGB").save(os.path.join(d, "T_PlayerSleeve_Wear.png"))
    print(f"sleeve wear: grime mean {grime.mean():.3f} (cuff rows {grime[-a.size // 10:].mean():.3f}), stain mean {stain.mean():.3f}")


if __name__ == "__main__":
    main()
