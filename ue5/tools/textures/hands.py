"""Hand detail decals (our own, generated): raised veins and ground-in dirt for the backs of the player's hands.

    tools/.venv/bin/python ue5/tools/textures/hands.py [--res 1024] [--out ue5/assets/textures/hands]

The player's first-person hands rest palm-down and still, so the game projects these from above as decals. The UV
square maps to the back of one hand: the wrist at v = 0, the knuckles at v ~ 0.8, fingers beyond. Veins branch from
the wrist towards the knuckles (dorsal venous network), raised in the normal map and slightly darker/bluer in colour;
dirt sits in specks, smudges and the knuckle creases, with darker nail-line grime at the top.
"""
import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument("--res", type=int, default=1024)
ap.add_argument("--out", default="ue5/assets/textures/hands")
ap.add_argument("--seed", type=int, default=3)
a = ap.parse_args()
R = a.res
rng = np.random.default_rng(a.seed)

height = np.zeros((R, R), np.float32)


def stroke(x0, y0, x1, y1, w, amp):
    """A wavy vein from (x0, y0) to (x1, y1) (pixels), radius w, painted into the height field."""
    n = int(np.hypot(x1 - x0, y1 - y0)) + 1
    t = np.linspace(0, 1, n)
    wob = ndimage.gaussian_filter1d(np.cumsum(rng.normal(0, 1.6, n)), max(n / 9, 1)); wob -= np.linspace(wob[0], wob[-1], n)  # gentle S-curves
    nx, ny = -(y1 - y0) / max(n, 1), (x1 - x0) / max(n, 1)
    xs = x0 + (x1 - x0) * t + nx * wob * 3
    ys = y0 + (y1 - y0) * t + ny * wob * 3
    for x, y, tt in zip(xs, ys, t):
        r = w * (1.0 - 0.45 * tt)
        x_i, y_i = int(x), int(y)
        lo_x, hi_x, lo_y, hi_y = max(0, x_i - int(r) - 2), min(R, x_i + int(r) + 3), max(0, y_i - int(r) - 2), min(R, y_i + int(r) + 3)
        if lo_x >= hi_x or lo_y >= hi_y:
            continue
        yy, xx = np.mgrid[lo_y:hi_y, lo_x:hi_x]
        d = np.hypot(xx - x, yy - y) / max(r, 0.5)
        height[lo_y:hi_y, lo_x:hi_x] = np.maximum(height[lo_y:hi_y, lo_x:hi_x], amp * np.clip(1 - d * d, 0, 1) ** 0.5)
    return list(zip(xs, ys))


# dorsal venous network: two or three trunks from the wrist, branching towards each knuckle
knuckles = [(R * f, R * 0.18) for f in (0.22, 0.42, 0.6, 0.78)]   # image row 0 = top = knuckles (v ~ 0.8)
for kx, ky in knuckles:
    sx = R * rng.uniform(0.3, 0.7)
    path = stroke(sx, R * 0.98, kx + rng.normal(0, R * 0.02), ky + R * 0.12, R * 0.017, 1.0)
    for _ in range(2):  # side branches joining neighbours
        px, py = path[rng.integers(len(path) // 4, 3 * len(path) // 4)]
        stroke(px, py, px + rng.normal(0, R * 0.12), py - rng.uniform(R * 0.08, R * 0.2), R * 0.009, 0.6)
height = ndimage.gaussian_filter(height, R / 700)
# skin micro relief (fine creases) so the decal's normal is not glass-smooth between the veins
fine = ndimage.gaussian_filter(rng.random((R, R)).astype(np.float32), R / 900) * 0.15
lines = (np.sin(np.linspace(0, 90, R))[None, :] * 0.5 + 0.5) * ndimage.gaussian_filter(rng.random((R, R)).astype(np.float32), R / 120)
h = height + fine

gy, gx = np.gradient(h * 6.0)
n = np.dstack([-gx, gy, np.ones_like(h)])  # DirectX green (UE)
n /= np.linalg.norm(n, axis=2, keepdims=True)
normal = (n * 0.5 + 0.5)

# dirt: specks, smudges, knuckle creases, nail-line grime at the top edge
smudge = ndimage.gaussian_filter(rng.random((R // 8, R // 8)), 1.2)
smudge = np.kron(smudge, np.ones((8, 8)))[:R, :R]
smudge = np.clip((ndimage.gaussian_filter(smudge, R / 60) - 0.5) * 5, 0, 1)
specks = np.clip(ndimage.gaussian_filter((rng.random((R, R)) > 0.9994).astype(np.float32), rng.uniform(0.8, 1.6)) * 12, 0, 1)
yy, xx = np.mgrid[0:R, 0:R]
creases = np.zeros((R, R), np.float32)
for kx, ky in knuckles:
    creases = np.maximum(creases, np.exp(-(((xx - kx) / (R * 0.05)) ** 2 + ((yy - ky - R * 0.03) / (R * 0.012)) ** 2)))
nails = np.exp(-((yy - R * 0.02) / (R * 0.02)) ** 2) * (ndimage.gaussian_filter(rng.random((R, R)), 3) > 0.45)
dirt = np.clip(0.55 * smudge + 0.9 * specks + 0.7 * creases + 0.8 * nails, 0, 1)
fade = np.clip(np.minimum.reduce([xx, R - 1 - xx, yy, R - 1 - yy]) / (R * 0.12), 0, 1)  # soft edges: no decal border
vein_tint = np.clip(height, 0, 1)

col = np.zeros((R, R, 4), np.float32)
col[..., :3] = np.array([0.20, 0.13, 0.08]) * (1 - vein_tint[..., None] * 0.2) + np.array([0.0, 0.0, 0.03]) * vein_tint[..., None]
col[..., 3] = np.clip(dirt * 0.85 + vein_tint * 0.25, 0, 1) * fade
rough = np.clip(0.55 + 0.35 * dirt, 0, 1)

os.makedirs(a.out, exist_ok=True)
Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8), "RGBA").save(os.path.join(a.out, "T_HandDirt_BaseColor.png"))
Image.fromarray((np.clip(normal, 0, 1) * 255).astype(np.uint8)).save(os.path.join(a.out, "T_HandVeins_Normal.png"))
Image.fromarray((rough * 255).astype(np.uint8)).save(os.path.join(a.out, "T_HandDirt_Roughness.png"))
Image.fromarray((np.clip(height * 1.4, 0, 1) * fade * 255).astype(np.uint8)).save(os.path.join(a.out, "T_HandVeins_Mask.png"))  # normal-decal opacity
Image.fromarray((np.clip(h / max(h.max(), 1e-6), 0, 1) * 255).astype(np.uint8)).save(os.path.join(a.out, "preview_height.png"))
print("wrote hand decals", R)
