"""Player skin variants (our own procedural layers on the MetaHuman body textures): veins, tendons, nail grime, dirt,
scars, painted in the body's UV space from the 3D rest-pose position of every texel, so nothing seams or stretches.

    tools/.venv/bin/python ue5/tools/textures/skin.py --bc T_Body_BC_VT.tga --n T_Body_N_VT.tga --mesh body/ \
        --out C:/TownChess/assets/skin [--variants bare,dirty,scarred,tattooed,gloves]

Every variant also paints the legs as drab trousers (the player body wears only the MetaHuman shirt). tattooed: faded
ink in forearm cylinder coordinates; gloves: worn leather over the hands and 5 cm of forearm.

Inputs (not in the repo, they are Epic MetaHuman content):
  --bc / --n   the cinematic body's baked base colour (4K) and normal (8K), exported by ue5/TownChess/Scripts/export_body.py
  --mesh       the body mesh dumped by ue5/tools/blender/dump_mesh.py (rest-pose positions, normals, UVs, skin weights)
Outputs, per variant: T_PlayerSkin_<variant>_BC.png (4K sRGB) and T_PlayerSkin_<variant>_N.png (8K, DirectX green),
imported by build_scene.py as virtual textures and swapped into a child of MI_Body_Baked_VT.

Why: the Walter body's base colour is one flat tan from wrist to elbow (a -TCSource=basecolor close-up shows no vein,
tendon or nail detail) and its normal map has only pores, so the reference's veiny, dirty hands cannot come from
material parameters. Only the hands and forearms are changed; the rest of the body is copied, desaturated a little.
"""
import argparse
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
ap = argparse.ArgumentParser()
ap.add_argument("--bc", required=True)
ap.add_argument("--n", required=True)
ap.add_argument("--mesh", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--variants", default="bare,dirty,scarred,tattooed,gloves")
ap.add_argument("--seed", type=int, default=7)
ap.add_argument("--preview", action="store_true", help="also write 1K crops of the hand islands")
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
R = 4096


def log(*x):
    print("[skin]", *x, flush=True)


# ---------------------------------------------------------------- mesh -> per-texel attributes (sparse, arms only)
D = a.mesh
co = np.fromfile(os.path.join(D, "co.bin"), np.float32).reshape(-1, 3)
nrm = np.fromfile(os.path.join(D, "nrm.bin"), np.float32).reshape(-1, 3)
dom = np.fromfile(os.path.join(D, "dom.bin"), np.int32)
uv = np.fromfile(os.path.join(D, "uv.bin"), np.float32).reshape(-1, 2)
tl = np.fromfile(os.path.join(D, "tri_l.bin"), np.int32).reshape(-1, 3)
tv = np.fromfile(os.path.join(D, "tri_v.bin"), np.int32).reshape(-1, 3)
G = json.load(open(os.path.join(D, "groups.json")))
FINGERS = ("thumb", "index", "middle", "ring", "pinky")
LEG = ("thigh", "calf", "foot", "ball", "ankle", "bigtoe", "littletoe")


def cls_of(name):
    """0 other, 1 forearm, 2 hand (back/palm), 3 finger, 4 upper arm, 5 leg/hips (painted as trousers); side +1 left /
    -1 right."""
    side = 1 if name.endswith("_l") else -1 if name.endswith("_r") else 0
    if name == "pelvis" or name.startswith(LEG):
        return 5, side
    if side == 0:
        return 0, side
    if name.startswith("lowerarm"):
        return 1, side
    if name.startswith("hand") or "metacarpal" in name:
        return 2, side
    if name.startswith(FINGERS):
        return 3, side
    if name.startswith("upperarm"):
        return 4, side
    return 0, side


gcls = np.array([cls_of(g) for g in G] + [(0, 0)], np.int32)  # index -1 -> last row
vcls, vside = gcls[dom, 0], gcls[dom, 1]


def gmean(pred, what=co):
    m = np.array([pred(g) for g in G] + [False])[dom]
    return what[m].mean(0)


LM = {}
for s, sfx in ((1, "_l"), (-1, "_r")):
    elbow = gmean(lambda g: g.startswith("lowerarm_") and g.endswith(sfx) and "twist" not in g)
    hand = gmean(lambda g: g == "hand" + sfx)
    tw1 = gmean(lambda g: g == "lowerarm_twist_01" + sfx)
    wrist = 0.5 * (hand + tw1)
    knuck = gmean(lambda g: g.endswith("_01_mcp" + sfx) and not g.startswith("thumb"))
    mcps = [gmean(lambda g, f=f: g == f"{f}_01_mcp{sfx}") for f in ("index", "middle", "ring", "pinky")]
    dorsal = gmean(lambda g: g.endswith("_01_mcp" + sfx) and not g.startswith("thumb"), nrm)
    df = (wrist - elbow) / np.linalg.norm(wrist - elbow)
    dh = (knuck - wrist) / np.linalg.norm(knuck - wrist)
    dors = dorsal - dorsal.dot(dh) * dh
    LM[s] = dict(elbow=elbow, wrist=wrist, knuck=knuck, mcps=mcps, df=df, dh=dh, dors=dors / np.linalg.norm(dors),
                 Lk=float(np.linalg.norm(knuck - wrist)), Lf=float(np.linalg.norm(wrist - elbow)))
    log("side", s, "wrist", wrist.round(1), "knuckles", knuck.round(1), "forearm", round(LM[s]["Lf"], 1), "hand", round(LM[s]["Lk"], 1))

# arms, plus the legs: the player body wears only the MetaHuman shirt, so its bare knees showed in every downward view
# (visual judge run 4); every variant paints them as dark institutional trousers
arm_tri = np.isin(vcls[tv], (1, 2, 3, 4)).all(1) | (vcls[tv] == 5).all(1)
log("arm+leg triangles", int(arm_tri.sum()), "of", len(tv))
idx_l, pos_l, nrm_l, cls_l, side_l, cmpt_l = [], [], [], [], [], []
for t in np.nonzero(arm_tri)[0]:
    vi, li = tv[t], tl[t]
    P = np.stack([(uv[li, 0] - np.floor(uv[li, 0].min())) * R - 0.5, (1.0 - uv[li, 1]) * R - 0.5], 1)
    x0, y0 = np.floor(P.min(0)).astype(int)
    x1, y1 = np.ceil(P.max(0)).astype(int)
    xs, ys = np.meshgrid(np.arange(max(x0, 0), min(x1 + 1, R)), np.arange(max(y0, 0), min(y1 + 1, R)))
    xs, ys = xs.ravel(), ys.ravel()
    (ax, ay), (bx, by), (cx, cy) = P
    den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(den) < 1e-9:
        continue
    w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
    w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
    w2 = 1 - w0 - w1
    m = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
    if not m.any():
        continue
    W = np.stack([w0[m], w1[m], w2[m]], 1)
    idx_l.append(ys[m] * R + xs[m])
    pos_l.append(W @ co[vi])
    nn = W @ nrm[vi]
    nrm_l.append(nn / np.linalg.norm(nn, axis=1, keepdims=True))
    k = np.argmax(W, 1)
    cls_l.append(vcls[vi][k]); side_l.append(vside[vi][k])
    a3 = 0.5 * np.linalg.norm(np.cross(co[vi[1]] - co[vi[0]], co[vi[2]] - co[vi[0]]))
    cmpt_l.append(np.full(m.sum(), np.sqrt(a3 / max(abs(den) * 0.5, 1e-6)), np.float32))
idx = np.concatenate(idx_l)
idx, first = np.unique(idx, return_index=True)
pos = np.concatenate(pos_l)[first].astype(np.float32)
nor = np.concatenate(nrm_l)[first].astype(np.float32)
cls = np.concatenate(cls_l)[first]
side = np.concatenate(side_l)[first]
cmpt = np.concatenate(cmpt_l)[first]
del idx_l, pos_l, nrm_l, cls_l, side_l, cmpt_l
log("arm texels", len(idx), "median cm/texel", float(np.median(cmpt)).__round__(4))


# ---------------------------------------------------------------- 3D gradient noise
def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    return (h ^ (h >> 16)) & 0xFFFF


_GR = np.array([[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
                [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, -1, -1]], np.float32)


def perlin(p, seed=0):
    out = np.empty(len(p), np.float32)
    for s in range(0, len(p), 400000):
        q = p[s:s + 400000].astype(np.float64)
        i = np.floor(q).astype(np.int64)
        f = (q - i).astype(np.float32)
        u = f * f * f * (f * (f * 6 - 15) + 10)
        acc = np.zeros(len(q), np.float32)
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    g = _GR[_hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed) & 15]
                    d = f - np.array([dx, dy, dz], np.float32)
                    wgt = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                    acc += wgt * (g * d).sum(1)
        out[s:s + 400000] = acc
    return out


def fbm(p, octaves, seed):
    v, amp, tot = np.zeros(len(p), np.float32), 1.0, 0.0
    for o in range(octaves):
        v += amp * perlin(p * (2.0 ** o), seed + o * 31)
        tot += amp
        amp *= 0.5
    return v / tot


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- per-texel frames
Ls = {s: LM[s] for s in (1, -1)}
tf = np.zeros(len(idx), np.float32); th = np.zeros(len(idx), np.float32); dors = np.zeros(len(idx), np.float32)
axis = np.zeros((len(idx), 3), np.float32)
for s in (1, -1):
    m = side == s
    L = Ls[s]
    rel = pos[m] - L["wrist"]
    tf[m] = rel @ L["df"]
    th[m] = rel @ L["dh"] / L["Lk"]          # 0 at the wrist, 1 at the knuckles
    dors[m] = nor[m] @ L["dors"]
    axis[m] = L["df"]
q = pos + (0.32 - 1.0) * (pos * axis).sum(1, keepdims=True) * axis   # squash along the limb: features run along it
warp = np.stack([fbm(pos * 0.18, 2, 101 + k) for k in range(3)], 1) * 2.2
qw = q + warp

hand_back = (cls == 2) & (th > -0.1) & (th < 1.02)
forearm = (cls == 1) | ((cls == 2) & (th <= -0.1))
Lf_t = np.where(side > 0, Ls[1]["Lf"], Ls[-1]["Lf"]).astype(np.float32)
fade_elbow = smooth(-0.95, -0.6, tf / Lf_t)  # tf/Lf = -1 at the elbow

# veins: ridged noise (|n| small), two scales; a low-frequency gate breaks the network into separate branches
n1 = perlin(qw * 0.42, 11)
n2 = perlin(qw * 0.95, 23)
gate = smooth(-0.15, 0.25, fbm(pos * 0.22, 2, 37))
# width/height taper along each vein (even "worms" read embossed: visual judge run 4); heights roughly halved
taper = 0.35 + 0.65 * smooth(-0.35, 0.35, fbm(qw * 0.3, 2, 47))
v1 = np.clip(1 - (np.abs(n1) / (0.1 * (0.55 + 0.45 * taper))) ** 2, 0, 1) ** 2      # soft rounded profile (a sqrt profile read as flat bands)
v2 = np.clip(1 - (np.abs(n2) / 0.065) ** 2, 0, 1) ** 2 * gate
vein_mask = np.where(hand_back, smooth(-0.05, 0.45, dors) * (1 - smooth(0.78, 0.98, th)) * smooth(-0.1, 0.12, th), 0)
vein_mask += np.where(forearm, fade_elbow * (0.55 + 0.45 * smooth(-0.6, 0.4, dors)), 0)
vein_mask += np.where(hand_back & (th < 0.12), smooth(-0.3, 0.3, dors) * 0.6, 0)  # across the wrist
vein_mask = np.clip(vein_mask, 0, 1)
# forearms: a few long trunks (gated), the backs of the hands the full network
v1 = np.where(forearm, v1 * smooth(-0.05, 0.2, fbm(pos * 0.15, 2, 41)), v1)
vein = np.maximum(v1, 0.65 * v2 * np.where(forearm, 0.4, 1.0)) * vein_mask * taper
h_vein = vein * np.where(hand_back, 0.075, 0.045)  # cm (0.13/0.08 before pass 60)

# extensor tendons: from a narrow fan at the wrist to each knuckle, strongest just behind the knuckles
h_tend = np.zeros(len(idx), np.float32)
for s in (1, -1):
    m = np.nonzero(hand_back & (side == s))[0]
    if not len(m):
        continue
    L = Ls[s]
    P = pos[m]
    for k, mc in enumerate(L["mcps"]):
        w0 = L["wrist"] + (mc - L["knuck"]) * 0.35
        seg = mc - w0
        tt = np.clip(((P - w0) @ seg) / seg.dot(seg), 0, 1)
        d = np.linalg.norm(P - (w0 + tt[:, None] * seg), axis=1)
        prof = np.clip(1 - (d / 0.42) ** 2, 0, 1) ** 0.6 * smooth(0.25, 0.85, tt) * (1 - smooth(0.95, 1.05, tt))
        h_tend[m] = np.maximum(h_tend[m], prof * 0.07 * smooth(0.0, 0.5, dors[m]))
log("veins/tendons", round(float((vein > 0.3).mean()), 3))

# knuckle redness, age spots
knuck_red = np.where((cls == 3) | ((cls == 2) & (th > 0.8)), smooth(0.1, 0.7, dors), 0) * smooth(0.0, 0.5, fbm(pos * 0.8, 2, 51) + 0.3)
spots = np.where(hand_back | forearm, smooth(0.42, 0.6, fbm(pos * 1.6, 2, 61)), 0) * smooth(0.0, 0.4, dors)

# trousers on the legs: drab cotton drill, folds behind the knees and over the thighs, a coarse weave
leg = cls == 5
h_cloth = np.zeros(len(idx), np.float32)
cloth_mot = np.zeros(len(idx), np.float32)
if leg.any():
    pl = pos[leg]
    folds = 1 - np.abs(perlin(pl * np.array([0.35, 0.35, 0.12], np.float32) + fbm(pl * 0.1, 2, 501)[:, None] * 2.0, 503))
    h_cloth[leg] = 0.22 * smooth(0.55, 0.95, folds) + 0.06 * fbm(pl * 0.6, 2, 507)
    weave = np.sin(pl[:, 0] * 2 * np.pi / 0.09) * np.sin(pl[:, 2] * 2 * np.pi / 0.09) + np.sin(pl[:, 1] * 2 * np.pi / 0.09)
    h_cloth[leg] += 0.004 * weave
    cloth_mot[leg] = fbm(pl * 0.25, 3, 509)

# cylinder coordinates round each forearm (for tattoos): along = cm from the wrist towards the elbow, arc = cm round
# the arm from the back of the forearm (+ = the player's right, ortho = forward x dorsal in Blender's right-handed space)
along = -tf
arc = np.zeros(len(idx), np.float32)
for s in (1, -1):
    m = side == s
    L = Ls[s]
    rel = pos[m] - L["wrist"]
    perp = rel - (rel @ L["df"])[:, None] * L["df"]
    ortho = np.cross(L["df"], L["dors"])
    arc[m] = np.arctan2(perp @ ortho, perp @ L["dors"]) * np.linalg.norm(perp, axis=1)

# gloves: hands, fingers and 5 cm of forearm (a cuff with a rolled hem)
glove = ((cls == 2) | (cls == 3) | ((cls == 1) & (along < 5.0))).astype(np.float32)
cuff = np.where(cls != 5, np.exp(-((along - 4.6) / 0.35) ** 2), 0) * (cls < 4)
h_glove = (0.012 * fbm(pos * 9.0, 2, 601)                                         # pebbled leather grain
           + 0.05 * cuff                                                          # rolled hem
           - 0.025 * np.exp(-(dors / 0.07) ** 2) * (cls == 3)                     # side seams of the fingers
           + 0.02 * np.abs(np.sin((pos @ np.array([0.0, 0.0, 1.0], np.float32)) * 9.0)) * (cls == 3) * smooth(0.2, 0.6, dors))  # knuckle wrinkles
h_glove *= glove


def tattoo_sheet():
    """Faded prison-style ink as a 2D sheet in forearm cylinder coordinates (40 px per cm; x = arc -6..6 cm,
    y = 0..22 cm from the wrist): left arm a knight over 'B-65' and a barbed-wire wrist band, right arm tally marks
    and a small chequer."""
    from PIL import ImageDraw, ImageFont
    S = 40
    sheets = {}
    font_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "fonts", "CourierPrime-Bold.ttf")
    for s in (1, -1):
        im = Image.new("L", (12 * S, 22 * S), 0)
        d = ImageDraw.Draw(im)
        X = lambda cm: int((cm + 6) * S)
        Y = lambda cm: int(cm * S)
        # barbed wire round the wrist: two twisted strands with barbs
        xs = np.linspace(-6, 6, 400)
        for ph in (0, np.pi):
            pts = [(X(x), Y(3.2 + 0.25 * np.sin(x * 2.4 + ph))) for x in xs]
            d.line(pts, fill=255, width=5)
        for x in np.arange(-5.5, 6, 1.4):
            d.line([(X(x - 0.25), Y(2.85)), (X(x + 0.25), Y(3.55))], fill=255, width=5)
            d.line([(X(x + 0.25), Y(2.85)), (X(x - 0.25), Y(3.55))], fill=255, width=5)
        if s == 1:
            # knight head silhouette (nose to the player's left), mane notches, on a plinth
            k = [(0.62, 1.0), (0.66, 0.62), (0.75, 0.45), (0.72, 0.25), (0.6, 0.1), (0.5, 0.0), (0.44, 0.1), (0.3, 0.14),
                 (0.15, 0.3), (0.05, 0.45), (0.08, 0.55), (0.22, 0.58), (0.33, 0.5), (0.4, 0.55), (0.25, 0.8), (0.2, 1.0)]
            kx, ky = lambda u: (u - 0.42) * 6.0, lambda v: 7.5 + v * 8.5   # 5 x 8.5 cm
            d.polygon([(X(kx(u)), Y(ky(v))) for u, v in k], outline=255, fill=200)
            d.line([(X(kx(0.62)), Y(ky(0.2))), (X(kx(0.7)), Y(ky(0.6)))], fill=60, width=7)   # mane line
            d.ellipse([X(kx(0.32)) - 9, Y(ky(0.27)) - 9, X(kx(0.32)) + 9, Y(ky(0.27)) + 9], fill=0)  # eye
            d.rectangle([X(-2.6), Y(16.4), X(2.4), Y(17.2)], fill=255)
            try:
                f = ImageFont.truetype(font_path, int(2.2 * S))
                d.text((X(0), Y(19.4)), "B-65", font=f, fill=235, anchor="mm")
            except OSError:
                log("tattoo font missing", font_path)
        else:
            for row in range(3):
                for g in range(2 if row < 2 else 1):
                    x0, y0 = -3.6 + g * 3.8, 6.5 + row * 3.2
                    for t in range(4):
                        d.line([(X(x0 + t * 0.6), Y(y0)), (X(x0 + t * 0.6 + 0.08), Y(y0 + 2.3))], fill=255, width=8)
                    d.line([(X(x0 - 0.4), Y(y0 + 1.8)), (X(x0 + 2.3), Y(y0 + 0.4))], fill=255, width=8)
            for i in range(3):
                for j in range(3):
                    if (i + j) % 2 == 0:
                        d.rectangle([X(-1.8 + i * 1.2), Y(16.3 + j * 1.2), X(-0.6 + i * 1.2), Y(17.5 + j * 1.2)], fill=255)
            d.rectangle([X(-1.8), Y(16.3), X(1.8), Y(19.9)], outline=255, width=6)
        a_ = np.asarray(im).astype(np.float32) / 255.0
        sheets[s] = ndimage.gaussian_filter(a_, 1.6)  # ink spread under the skin
    return sheets, S

# ---------------------------------------------------------------- dense images
bc_full = np.asarray(Image.open(a.bc).convert("RGB")).astype(np.float32) / 255.0
assert bc_full.shape[:2] == (R, R), bc_full.shape
yy, xx = idx // R, idx % R


def dense(vals, fill=0.0):
    img = np.full((R, R), fill, np.float32)
    img[yy, xx] = vals
    return img


# nails: lighter, pinker patches on the finger tips in the base colour
lum = bc_full.mean(2)
tip = dense(((cls == 3) & (th > 1.2) & (dors > 0.15)).astype(np.float32))
tip = ndimage.binary_erosion(tip > 0, iterations=10).astype(np.float32)  # island edges are not nails
nail = np.clip((lum - ndimage.gaussian_filter(lum, 18)) / 0.035, 0, 1) * tip
nail = ndimage.gaussian_filter(np.clip(ndimage.grey_closing(nail, size=5) * 1.5, 0, 1), 1.0)
rim = np.clip(ndimage.grey_dilation(nail, size=9) - nail, 0, 1) * dense(np.clip((th - 1.3) * 2, 0, 1))  # skin around the nail, distal side weighted
log("nail texels", int((nail > 0.5).sum()))

# creases from the original normal map's curvature (4K), for dirt in knuckle folds and around nails
n8 = Image.open(a.n)
n4 = np.asarray(n8.convert("RGB").resize((R, R), Image.BILINEAR)).astype(np.float32) / 127.5 - 1.0
del n8
curv = np.gradient(n4[..., 0], axis=1) - np.gradient(n4[..., 1], axis=0)
del n4
crease_raw = ndimage.gaussian_filter(curv, 3.0)
crease = np.clip(-crease_raw / (np.percentile(np.abs(crease_raw[yy, xx]), 90) + 1e-6), 0, 1)

cm_img = dense(cmpt, float(np.median(cmpt)))
cm_img = ndimage.grey_dilation(cm_img, size=3)


def dilate_fill(img, mask, px=10):
    """push the arm values out past the island edges so mips and bilinear filtering do not pull in unchanged texels."""
    d, (iy, ix) = ndimage.distance_transform_edt(~mask, return_indices=True)
    out = img[iy, ix]
    return np.where(d <= px, out, img)


arm_mask = dense(np.ones(len(idx), np.float32)) > 0


def variant(name, rng):
    grime_amt = {"bare": 0.35, "dirty": 1.0, "scarred": 0.45, "tattooed": 0.5, "gloves": 0.6}[name]
    # dirt: blotches, creases, around the nails and on the finger pads' sides
    blot = smooth(-0.05, 0.35, fbm(pos * 0.5, 3, 71 + len(name)))
    fine = smooth(0.1, 0.45, fbm(pos * 3.0, 2, 83))
    cre = crease[yy, xx]
    g = np.clip(0.55 * blot * (0.4 + 0.6 * fine) + 0.45 * cre * (0.3 + 0.7 * blot), 0, 1)
    g *= np.where(cls == 4, 0.2, 1.0) * np.where(cls == 3, 1.3, 1.0) * np.where(hand_back | (cls == 3), 1.0, 0.6)
    grime = np.clip(g * grime_amt, 0, 1)
    nail_dirt = np.clip(rim[yy, xx] * (0.5 + 0.5 * grime_amt) + nail[yy, xx] * 0.25 * grime_amt, 0, 1)
    h_scar = np.zeros(len(idx), np.float32)
    scar = np.zeros(len(idx), np.float32)
    if name == "scarred":
        cand = np.nonzero((forearm | hand_back) & (dors > 0.2) & (fade_elbow > 0.6))[0]
        for k in range(9):
            c = pos[cand[rng.integers(len(cand))]]
            L = Ls[1 if c[0] > 0 else -1]
            ang = rng.uniform(-1.2, 1.2) + np.pi / 2
            ortho = np.cross(L["df"], L["dors"])
            dirv = np.cos(ang) * L["df"] + np.sin(ang) * ortho
            half = rng.uniform(1.2, 3.5) if k else 4.5
            a0, a1 = c - dirv * half, c + dirv * half
            seg = a1 - a0
            tt = np.clip(((pos - a0) @ seg) / seg.dot(seg), 0, 1)
            d = np.linalg.norm(pos - (a0 + tt[:, None] * seg), axis=1)
            wid = rng.uniform(0.13, 0.22) if k else 0.2   # 1.3-2.2 mm half-width: thinner vanished at the seat's distance
            prof = np.clip(1 - (d / wid) ** 2, 0, 1) ** 0.5 * smooth(0.0, 0.06, tt) * smooth(0.0, 0.06, 1 - tt)
            prof *= 0.6 + 0.4 * smooth(-0.3, 0.3, perlin(pos * 2.5, 300 + k))
            if not k:  # one stitched wound: ticks across it every ~0.6 cm
                u_along = tt * 2 * half
                tick = (np.abs(((u_along + 0.3) % 0.6) - 0.3) < 0.05) & (d < 0.42)
                prof = np.maximum(prof, tick * 0.8)
            scar = np.maximum(scar, prof)
            h_scar = np.maximum(h_scar, prof * 0.05)
    # colour
    col = bc_full[yy, xx].copy()
    vt = vein * 0.85
    col *= (1 - np.stack([0.20 * vt, 0.13 * vt, 0.02 * vt], 1))
    col = col * (1 - 0.12 * knuck_red[:, None]) + col * np.array([1.18, 0.86, 0.84], np.float32) * 0.12 * knuck_red[:, None]
    col *= 1 - 0.18 * spots[:, None] * np.array([0.7, 0.9, 1.0], np.float32)
    gc = np.array([0.42, 0.33, 0.24], np.float32)
    col = col * (1 - grime[:, None]) + col * gc * grime[:, None]
    # nail plates: paler and pinker than the finger, a whiter free edge (no image showed a nail before pass 60)
    nl = nail[yy, xx]
    free = nl * np.clip((th - 1.55) * 4, 0, 1)
    col = col * (1 - 0.55 * nl[:, None]) + np.clip(col * np.array([1.12, 1.0, 0.98], np.float32) + 0.1, 0, 1) * 0.55 * nl[:, None]
    col = col * (1 - 0.35 * free[:, None]) + np.array([0.78, 0.72, 0.62], np.float32) * 0.35 * free[:, None]
    col = col * (1 - nail_dirt[:, None]) + np.array([0.06, 0.045, 0.035], np.float32) * nail_dirt[:, None]
    if name == "dirty":  # dried blood specks on the knuckles and the back of the hand
        sp = smooth(0.52, 0.62, perlin(pos * 3.2, 401)) * smooth(0.2, 0.6, dors) * np.where(hand_back | (cls == 3), 1, 0)
        col = col * (1 - sp[:, None] * 0.85) + np.array([0.16, 0.03, 0.025], np.float32) * sp[:, None] * 0.85
    if name == "scarred":
        col = col * (1 - scar[:, None]) + np.clip(col * np.array([1.3, 1.08, 1.05], np.float32) + 0.07, 0, 1) * scar[:, None]
    h_extra = np.zeros(len(idx), np.float32)
    if name == "tattooed":  # faded blue-black ink, uneven (hand-poked), under the grime
        sheets, S = tattoo_sheet()
        ink = np.zeros(len(idx), np.float32)
        for s_ in (1, -1):
            m = np.nonzero((side == s_) & ((cls == 1) | ((cls == 2) & (th < 0.05))))[0]
            sh = sheets[s_]
            px = np.clip(((arc[m] + 6) * S).astype(int), 0, sh.shape[1] - 1)
            py = np.clip((along[m] * S).astype(int), 0, sh.shape[0] - 1)
            inside = (np.abs(arc[m]) < 6) & (along[m] >= 0) & (along[m] < 22)
            ink[m] = sh[py, px] * inside
        ink *= 0.55 + 0.35 * smooth(-0.4, 0.4, perlin(pos * 1.5, 701))
        ink = np.clip(ink, 0, 0.8)
        col = col * (1 - ink[:, None]) + col * np.array([0.2, 0.26, 0.3], np.float32) * ink[:, None]
    if name == "gloves":  # worn dark leather, scuffed paler on the knuckles, grime in the creases
        gl = glove
        lea = np.array([0.2, 0.125, 0.08], np.float32) * (0.8 + 0.4 * (0.5 + 0.5 * fbm(pos * 1.2, 3, 611)))[:, None]
        scuff = smooth(0.3, 0.8, dors) * ((cls == 3) | ((cls == 2) & (th > 0.75))) * smooth(-0.1, 0.4, fbm(pos * 2.5, 2, 613))
        lea = lea * (1 - 0.5 * scuff[:, None]) + np.array([0.36, 0.27, 0.2], np.float32) * 0.5 * scuff[:, None]
        lea *= 1 - 0.45 * np.clip(cre + grime * 0.5, 0, 1)[:, None]
        lea *= 1 - 0.25 * cuff[:, None]
        col = col * (1 - gl[:, None]) + lea * gl[:, None]
        h_extra = h_glove
    # legs: trousers in every variant (the player body wears only the shirt: the bare knees showed in the hand close-ups)
    cloth = np.array([0.19, 0.18, 0.15], np.float32) * (0.85 + 0.3 * (0.5 + 0.5 * cloth_mot))[:, None]
    cloth *= 1 - 0.15 * blot[:, None] * np.array([0.9, 1.0, 1.1], np.float32)
    col = np.where(leg[:, None], cloth, col)
    out = bc_full.copy()
    delta = np.zeros((R, R, 3), np.float32)
    delta[yy, xx] = col - bc_full[yy, xx]
    for c in range(3):
        delta[..., c] = dilate_fill(delta[..., c], arm_mask)
    out = np.clip(out + delta, 0, 1)
    # whole body: less orange (the reference's skin is pale and pink-grey, ours tan-orange)
    lumo = (out * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(2, keepdims=True)
    out = lumo + (out - lumo) * 0.78
    Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(os.path.join(a.out, f"T_PlayerSkin_{name}_BC.png"), optimize=False)
    # height -> slope (per cm) at 4K, DirectX-style normal delta
    skin_h = (h_vein + h_tend) * (1 - (glove if name == "gloves" else 0)) + 0.015 * nail[yy, xx] * (name != "gloves")
    hgt = dense(skin_h + h_scar + h_extra + h_cloth)
    hgt = ndimage.gaussian_filter(hgt, 0.7)
    gy, gx = np.gradient(hgt)
    sx, sy = gx / cm_img, gy / cm_img
    sx = dilate_fill(sx, arm_mask, 6); sy = dilate_fill(sy, arm_mask, 6)
    if a.preview:
        y0, y1, x0, x1 = 0, 1850, 0, R
        Image.fromarray((out[y0:y1:2, x0:x1:2] * 255).astype(np.uint8)).save(os.path.join(a.out, f"preview_{name}_bc.png"))
        hp = np.clip(0.5 + sx[y0:y1:2, x0:x1:2] * 0.6, 0, 1)
        Image.fromarray((hp * 255).astype(np.uint8)).save(os.path.join(a.out, f"preview_{name}_slope.png"))
    del out, delta
    flat = dense((leg | (glove > 0.5 if name == "gloves" else np.zeros(len(idx), bool))).astype(np.float32))
    write_normal(name, sx.astype(np.float32), sy.astype(np.float32), ndimage.gaussian_filter(flat, 2.0))


def write_normal(name, sx, sy, flat):
    """our slopes on top of the body's normal map; `flat` (0..1) fades the original detail (skin pores under cloth/leather)"""
    n8 = Image.open(a.n).convert("RGB")
    W = n8.size[0]
    f = W // R
    src = np.asarray(n8)
    del n8
    out = np.empty_like(src)
    for y0 in range(0, W, 1024):
        blk = src[y0:y0 + 1024].astype(np.float32) / 127.5 - 1.0
        ys = slice(y0 // f, (y0 + 1024) // f)
        bx = ndimage.zoom(sx[ys], f, order=1)[:blk.shape[0], :W]
        by = ndimage.zoom(sy[ys], f, order=1)[:blk.shape[0], :W]
        keep = 1 - 0.85 * ndimage.zoom(flat[ys], f, order=1)[:blk.shape[0], :W]
        blk[..., 0] *= keep; blk[..., 1] *= keep
        nx, ny = blk[..., 0] - bx, blk[..., 1] - by     # DirectX: green follows image-down
        nz = np.sqrt(np.clip(1 - np.clip(blk[..., 0] ** 2 + blk[..., 1] ** 2, 0, 1), 0, 1))
        ln = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-6
        out[y0:y0 + 1024] = np.clip((np.stack([nx, ny, nz], 2) / ln[..., None] + 1) * 127.5, 0, 255).astype(np.uint8)
    Image.fromarray(out).save(os.path.join(a.out, f"T_PlayerSkin_{name}_N.png"), optimize=False)
    log("wrote", name)


rng = np.random.default_rng(a.seed)
for name in a.variants.split(","):
    variant(name, rng)
