"""The caged patient's filthy institutional gown (pass C8, judge run 6: "a clean, smooth beige gown"; the reference's
jacket is filthy and stained). Paints, in the MetaHuman DefaultGarment's own UV space, a worn canvas base colour with
dirt pooled in the folds (from the garment's AO), soiled and frayed seams (from its stitch mask), sweat-darkened
areas with tide-line rims, dried blood (dark brown-red, darker rims, a few drips) and rust streaks, plus a matching
roughness. build_scene.py (outfit_slot_material) puts them on an M_TC_PBR instance with the garment's own normal map
and a linen weave as the detail normal.

    tools/.venv/bin/python ue5/tools/textures/garment.py --src <dir with DG_bodyShapeA_{Shirt,Short}_{AO,StitchMask}.tga>
        --out C:/TownChess/assets/garment [--res 2048]

Inputs are Epic MetaHuman content (exported by the C8 export step), so the outputs stay in the workspace, not the repo.
Outputs per part: T_PatientGown_<Part>_BC.png (sRGB) and T_PatientGown_<Part>_ARM.png (R AO, G roughness, B 0).
"""
import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--res", type=int, default=2048)
ap.add_argument("--seed", type=int, default=8)
ap.add_argument("--parts", default="Shirt,Short")
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)


def noise(rng, R, scale, aniso=1.0):
    n = ndimage.gaussian_filter(rng.standard_normal((R, R)).astype(np.float32), (scale / 2.5, scale * aniso / 2.5), mode="wrap")
    return (n - n.mean()) / (n.std() + 1e-6)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)


def load(path, R):
    if not os.path.exists(path):
        return None
    im = Image.open(path).convert("RGB").split()[0]   # the maps keep their value in R (the AO's G is 1 everywhere)
    return np.asarray(im.resize((R, R), Image.BILINEAR)).astype(np.float32) / 255.0


def blobs(rng, R, n, rmin, rmax, island, rough=0.6):
    """n irregular stains inside the UV islands: noise-warped discs, returned as (mask, rim)"""
    m = np.zeros((R, R), np.float32)
    ys, xs = np.nonzero(island > 0.5)
    yy, xx = np.mgrid[0:R, 0:R].astype(np.float32)
    warp = noise(rng, R, R / 40) * rough
    for _ in range(n):
        k = rng.integers(len(ys))
        cy, cx = ys[k], xs[k]
        r = rng.uniform(rmin, rmax) * R
        ex = rng.uniform(0.6, 1.6)
        d = np.sqrt(((xx - cx) / ex) ** 2 + ((yy - cy) * ex) ** 2) / r + warp * 0.35
        m = np.maximum(m, smooth(1.0, 0.75, d) * rng.uniform(0.6, 1.0))
    rim = np.clip(m - ndimage.grey_erosion(m, size=max(3, R // 400)), 0, 1)
    rim = ndimage.gaussian_filter(rim, R / 1600)
    return m, rim


def paint(part, rng):
    R = a.res
    ao = load(os.path.join(a.src, f"DG_bodyShapeA_{part}_AO.tga"), R)
    st = load(os.path.join(a.src, f"DG_bodyShapeA_{part}_StitchMask.tga"), R)
    if ao is None:
        print("no AO for", part)
        return
    st = np.zeros_like(ao) if st is None else st
    island = (ndimage.gaussian_filter(ao, 2) > 0.02).astype(np.float32)   # texels the garment uses (AO 0 outside)
    edge = ndimage.distance_transform_edt(island) / R                       # distance into the island (hems, seams)
    # canvas: drab grey-beige, linear ~0.17/0.155/0.12 (C8: 0.26/0.23/0.18 still read as a clean beige gown), mottled
    base = np.array([0.17, 0.155, 0.12], np.float32)
    mot = 0.5 * noise(rng, R, R / 6) + 0.3 * noise(rng, R, R / 24) + 0.2 * noise(rng, R, R / 90)
    col = base[None, None] * (1 + 0.12 * mot)[..., None]
    rough = np.full((R, R), 0.9, np.float32)
    # dirt pooled in the folds: concavity from the AO (and the AO itself), grey-brown, matte
    fold = np.clip((1 - ao) * 1.6, 0, 1) ** 1.2
    film = smooth(-0.6, 0.8, noise(rng, R, R / 10))
    blot = smooth(-0.6, 1.8, noise(rng, R, R / 45)) * smooth(-0.4, 0.8, noise(rng, R, R / 12))                      # mid-size grime blotches (read from the seat)
    dirt = np.clip(fold * (0.6 + 0.4 * film) + 0.55 * film + 0.45 * blot, 0, 1)
    grime = np.array([0.42, 0.37, 0.3], np.float32)
    col = col * (1 - 0.85 * dirt[..., None]) + col * grime * 0.85 * dirt[..., None]
    rough += 0.06 * dirt
    # soiled, frayed seams and hems: a dark band along the stitches and the island edges, broken by fibre noise
    seam = np.clip(ndimage.gaussian_filter(st, R / 700) * 3, 0, 1)
    hem = smooth(0.012, 0.0, edge)
    fray = smooth(-0.3, 0.6, noise(rng, R, R / 300, aniso=4.0))
    soil = np.clip((seam * 0.8 + hem * 0.9) * (0.55 + 0.45 * fray), 0, 1)
    col *= (1 - 0.55 * soil)[..., None]
    # collar and neckline ring: sweat and skin grease worked into the cloth along the neck seam (wide, soft)
    ring = ndimage.gaussian_filter(st, R / 80)
    ring = np.clip(ring / (ring.max() + 1e-6) * 2.5, 0, 1) * island
    col *= (1 - 0.45 * ring * (0.7 + 0.3 * film))[..., None]
    pale = smooth(0.6, 1.4, noise(rng, R, R / 500, aniso=6.0)) * hem   # frayed threads catching the light at the hems
    col = col * (1 - 0.3 * pale[..., None]) + np.array([0.33, 0.3, 0.25], np.float32) * 0.3 * pale[..., None]
    # sweat: large soft darker areas with a yellow-brown tide line
    sw, swr = blobs(rng, R, 10, 0.05, 0.12, island, rough=1.0)
    sw = ndimage.gaussian_filter(sw, R / 300)
    col = col * (1 - 0.5 * sw[..., None]) + col * np.array([0.62, 0.55, 0.4], np.float32) * 0.5 * sw[..., None]
    col *= (1 - 0.25 * np.clip(swr * 3, 0, 1))[..., None]
    rough -= 0.08 * sw
    # dried blood: dark brown-red stains with darker rims, spatter and a few drips (gravity: image down = V down)
    bl, blr = blobs(rng, R, 24, 0.012, 0.06, island)
    spat = np.zeros((R, R), np.float32)
    ys, xs = np.nonzero(island > 0.5)
    for _ in range(50):
        k = rng.integers(len(ys))
        r = rng.uniform(0.6, 3.5) * R / 2048
        spat[ys[k], xs[k]] = 1
        if rng.random() < 0.05:  # a drip run below it
            L = int(rng.uniform(10, 60) * R / 2048)
            spat[ys[k]:ys[k] + L, xs[k]] = np.linspace(1, 0.3, len(spat[ys[k]:ys[k] + L, xs[k]]))
    spat = np.clip(ndimage.gaussian_filter(spat, 1.4 * R / 2048) * 6, 0, 1) * island
    if part == "Shirt":  # the front's upper chest is what shows above the steepled hands: a few big stains there
        front = np.zeros_like(island)
        front[int(0.45 * R):int(0.72 * R), int(0.08 * R):int(0.45 * R)] = 1   # front panel (lower-left island), below the neck
        fb, _ = blobs(rng, R, 4, 0.025, 0.055, island * front)
        bl = np.maximum(bl, fb)
    soak = ndimage.gaussian_filter(bl, R / 500) * 0.4                     # soaked into the weave round each stain
    blood = np.clip(np.maximum(ndimage.gaussian_filter(bl, R / 1500) * (0.92 + 0.08 * noise(rng, R, R / 200)), soak) + spat, 0, 1)
    age = smooth(-0.8, 0.8, noise(rng, R, R / 40))[..., None]             # older stains browner
    bcol = np.array([0.07, 0.016, 0.011], np.float32) * (1 - age) + np.array([0.08, 0.035, 0.02], np.float32) * age
    col = col * (1 - 0.95 * blood[..., None]) + bcol * 0.95 * blood[..., None]
    col *= (1 - 0.5 * np.clip(blr * 2.5, 0, 1) * (bl > 0.05))[..., None]
    rough = rough * (1 - blood) + 0.62 * blood
    # rust streaks (from the iron cage and the bed frames): orange-brown, streaky along V
    rs, _ = blobs(rng, R, 9, 0.015, 0.045, island, rough=1.2)
    rs = ndimage.gaussian_filter(rs, (R / 120, R / 350)) * smooth(-0.2, 0.8, noise(rng, R, R / 40, aniso=0.3))
    rs = np.clip(rs * 2.0, 0, 1)
    col = col * (1 - 0.6 * rs[..., None]) + np.array([0.16, 0.065, 0.025], np.float32) * 0.6 * rs[..., None]
    rough += 0.03 * rs
    # keep the texels outside the islands at the canvas colour (mips)
    col = np.where(island[..., None] > 0, col, base[None, None])
    Image.fromarray((to_srgb(col) * 255 + 0.5).astype(np.uint8)).save(os.path.join(a.out, f"T_PatientGown_{part}_BC.png"))
    arm = np.dstack([np.clip(0.35 + 0.65 * ao, 0, 1), np.clip(rough, 0, 1), np.zeros_like(ao)])
    Image.fromarray((arm * 255 + 0.5).astype(np.uint8)).save(os.path.join(a.out, f"T_PatientGown_{part}_ARM.png"))
    print("garment", part, "dirt", round(float(dirt[island > 0].mean()), 3), "blood", round(float(blood[island > 0].mean()), 3),
          "sweat", round(float(sw[island > 0].mean()), 3), "rust", round(float(rs[island > 0].mean()), 3), flush=True)


rng = np.random.default_rng(a.seed)
for p in a.parts.split(","):
    paint(p, rng)
