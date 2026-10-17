"""Procedural blood decals and handling-grime masks for TownChess (our own work, no third-party data).

Every texture is generated from a physically motivated model rather than painted blobs:
  * a blood mark is a signed-distance field F (pixels inside the stain, >0 inside) built from drops, pools, drag
    streaks or runs, with fractal (FFT 1/f) noise added at several scales so edges wick and scallop like real stains;
  * film thickness T comes from F (thicker away from the edge), the "coffee-ring" rim from exp(-F/w): as a drop dries,
    capillary flow carries red cells to the pinned edge, which ends up darker and raised;
  * dryness D grows towards thin areas and edges, and drives colour (fresh deep red -> brown-black), roughness
    (glossy wet centre -> matte dried film) and shrinkage cracks in thick dried areas.

Outputs (2048x2048 PNG unless --size):
  blood/<variant>_BaseColor.png  RGBA, sRGB colour, alpha = coverage (thin films are translucent stains)
  blood/<variant>_Normal.png     RGB, DirectX/UE convention (green = -dH/dy), raised rim, drops, cracks
  blood/<variant>_Roughness.png  L, linear
  grime/HandlingGrime_Mask.png   RGBA tileable: R smudges, G scratches, B fingerprints, A lacquer chips
  grime/HandlingGrime_Normal.png RGB tileable detail normal (scratches, chips, fingerprint ridges)
Variants: spatter (impact with satellites and tails), pool (dried rim, glossy centre, cracks), smear (drag mark with
streaks), drips (runs from an edge with beads).

Usage (repo venv, see docs/FREE_ASSETS.md):
  tools/.venv/bin/python ue5/tools/textures/blood.py [--out ue5/assets/textures] [--sheet docs/screenshots/assets/blood-sheet.png]
      [--wood DIR_WITH_POLYHAVEN_TEXTURES] [--size 2048] [--seed 7]
"""
import argparse, math, os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

# Linear-RGB blood colours (measured-ish: fresh venous blood on a white tile reads ~sRGB(110,10,15) when thick,
# a thin film ~sRGB(160,45,40); dried films go ~sRGB(60,26,20) and dried rims ~sRGB(38,15,11)).
FRESH_THICK = np.array([0.150, 0.0035, 0.0055])
FRESH_THIN = np.array([0.330, 0.028, 0.022])
DRIED = np.array([0.046, 0.011, 0.0075])
DRIED_RIM = np.array([0.019, 0.0052, 0.0036])


# ---------------------------------------------------------------- noise and helpers

def fbm(n, seed, beta=2.0, fmin=1.0, fmax=None, aniso=1.0, shape=None):
    """Tileable fractal noise (zero mean, unit std) by shaping white noise with a 1/f^beta power spectrum.
    fmin/fmax are cycles per image; aniso > 1 stretches features along x (wood-grain wicking)."""
    h, w = shape or (n, n)
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((h, w))
    fy = np.fft.fftfreq(h)[:, None] * h
    fx = np.fft.rfftfreq(w)[None, :] * w
    f = np.sqrt((fx * aniso) ** 2 + fy ** 2)
    amp = np.where(f < fmin, 0.0, 1.0 / np.maximum(f, 1e-6) ** (beta / 2))
    if fmax:
        amp *= np.exp(-(f / fmax) ** 2)
    out = np.fft.irfft2(np.fft.rfft2(white) * amp, s=(h, w))
    return ((out - out.mean()) / (out.std() + 1e-9)).astype(np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def to_srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def height_to_normal(h, strength, wrap=False):
    """Height (pixels of 'depth' units) -> DirectX tangent-space normal map, uint8 RGB."""
    if wrap:
        dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
        dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    else:
        dy, dx = np.gradient(h)
    nx, ny, nz = -dx * strength, -dy * strength, np.ones_like(h)  # DirectX: green = -dH/drow
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.dstack([(nx * inv + 1) * 127.5, (ny * inv + 1) * 127.5, (nz * inv + 1) * 127.5]).round().clip(0, 255).astype(np.uint8)


class Field:
    """Union of stamped shapes as an approximate signed distance (pixels, >0 inside), plus each pixel's shape size."""

    def __init__(self, n):
        self.n = n
        self.F = np.full((n, n), -1e3, np.float32)
        self.S = np.zeros((n, n), np.float32)

    def stamp(self, x0, y0, x1, y1, fn, size):
        n = self.n
        xa, ya, xb, yb = max(int(x0), 0), max(int(y0), 0), min(int(x1) + 1, n), min(int(y1) + 1, n)
        if xa >= xb or ya >= yb:
            return
        yy, xx = np.mgrid[ya:yb, xa:xb].astype(np.float32)
        f = fn(xx, yy)
        sub = self.F[ya:yb, xa:xb]
        better = f > sub
        sub[better] = f[better]
        self.S[ya:yb, xa:xb][better] = size

    def ellipse(self, cx, cy, a, b, ang, noise=None, amp=0.0):
        """Ellipse with semi-axes a (along ang) and b; edge displaced by amp * noise (pixels)."""
        ca, sa = math.cos(ang), math.sin(ang)
        r = max(a, b) + amp * 3 + 2

        def fn(xx, yy):
            u = (xx - cx) * ca + (yy - cy) * sa
            v = -(xx - cx) * sa + (yy - cy) * ca
            d = np.sqrt((u / a) ** 2 + (v / b) ** 2)
            f = (1.0 - d) * min(a, b)
            if noise is not None:
                f = f + amp * noise[yy.astype(int) % noise.shape[0], xx.astype(int) % noise.shape[1]]
            return f
        self.stamp(cx - r, cy - r, cx + r, cy + r, fn, min(a, b))

    def tail(self, cx, cy, ang, start, length, width, noise=None, amp=0.0):
        """Tapered streak from distance `start` to start+length along ang (spatter tails, finger streaks)."""
        ca, sa = math.cos(ang), math.sin(ang)
        ex, ey = cx + ca * (start + length), cy + sa * (start + length)
        sx, sy = cx + ca * start, cy + sa * start
        pad = width + amp * 3 + 2

        def fn(xx, yy):
            u = (xx - cx) * ca + (yy - cy) * sa
            v = -(xx - cx) * sa + (yy - cy) * ca
            t = np.clip((u - start) / length, 0, 1)
            half = width * (1 - t) ** 1.4
            f = np.minimum(half - np.abs(v), np.minimum(u - start + width, start + length - u))
            if noise is not None:
                f = f + amp * noise[yy.astype(int) % noise.shape[0], xx.astype(int) % noise.shape[1]]
            return f
        self.stamp(min(sx, ex) - pad, min(sy, ey) - pad, max(sx, ex) + pad, max(sy, ey) + pad, fn, width)


def voronoi_cracks(n, cell, seed, warp):
    """Shrinkage-crack network: warped Voronoi cell borders, 1 on a crack, ~2 px wide."""
    rng = np.random.default_rng(seed)
    k = int((n / cell) ** 2)
    seeds = np.zeros((n, n), bool)
    seeds[rng.integers(0, n, k), rng.integers(0, n, k)] = True
    _, (iy, ix) = ndimage.distance_transform_edt(~seeds, return_indices=True)
    lab = (iy * n + ix).astype(np.int64)
    wy = (np.arange(n)[:, None] + warp[0]).astype(int) % n
    wx = (np.arange(n)[None, :] + warp[1]).astype(int) % n
    lab = lab[wy, wx]
    edge = (lab != np.roll(lab, 1, 0)) | (lab != np.roll(lab, 1, 1))
    return ndimage.binary_dilation(edge, iterations=1).astype(np.float32)


# ---------------------------------------------------------------- blood: shared shading

def finish_blood(F, S, n, seed, age, rim_w=0.12, rim_min=1.5, rim_max=14.0, thick_px=40.0, crack_cell=0.0,
                 extra_h=None, wet_bias=0.0):
    """Signed distance F (+ shape sizes S) -> BaseColor RGBA, Normal, Roughness for a blood decal."""
    hf = fbm(n, seed + 1, beta=1.2, fmin=8)
    mf = fbm(n, seed + 2, beta=2.2, fmin=2)
    cov = smoothstep(-0.6, 1.4, F)  # 2 px anti-aliased edge
    Fi = np.maximum(F, 0)
    T = 1 - np.exp(-Fi / thick_px)                      # film thickness 0..1
    w = np.clip(S * rim_w, rim_min, rim_max)
    rim = np.exp(-Fi / w) * cov                         # coffee-ring deposit at the pinned edge
    # tide lines: secondary rings left as the contact line jumps inwards while drying
    tide = np.exp(-((Fi - w * 3.2 - 1.5 * mf) / (0.6 * w)) ** 2) * 0.45 * smoothstep(6, 18, S)
    D = np.clip(age + (1 - T) * 0.55 + rim * 0.35 + 0.12 * mf - wet_bias * T, 0, 1)  # dryness

    col = FRESH_THIN[None, None] + (FRESH_THICK - FRESH_THIN)[None, None] * T[..., None] ** 0.6
    dried = DRIED[None, None] * (1 + 0.25 * hf[..., None] * 0.5)
    col = col + (dried - col) * D[..., None] ** 1.3
    darken = np.clip(rim * 0.85 + tide, 0, 1)
    col = col + (DRIED_RIM[None, None] - col) * darken[..., None]
    col *= (1 + 0.06 * hf)[..., None]

    cracks = np.zeros_like(F)
    if crack_cell:
        warp = (fbm(n, seed + 3, beta=2.5, fmin=3) * crack_cell * 0.35, fbm(n, seed + 4, beta=2.5, fmin=3) * crack_cell * 0.35)
        cracks = voronoi_cracks(n, crack_cell, seed + 5, warp) * smoothstep(0.35, 0.6, T) * smoothstep(0.55, 0.8, D)
        col *= (1 - 0.55 * cracks)[..., None]

    # alpha: thin films are translucent stains soaked into the surface; beads and thick films are opaque
    alpha = cov * np.clip(0.55 + 0.9 * T + 0.5 * rim + 0.08 * hf, 0, 1)
    rough = 0.10 + 0.55 * D ** 1.5 + 0.12 * (1 - T) + 0.05 * hf * D
    rough = np.clip(rough + 0.25 * cracks, 0.05, 1.0)

    h = T * 2.0 + rim * 1.4 * smoothstep(0.3, 1, D) + tide * 0.4 - cracks * 1.2
    if extra_h is not None:
        h = h + extra_h
    h = ndimage.gaussian_filter(h * cov, 0.7)
    nrm = height_to_normal(h, 3.0)
    flat = cov < 0.01
    nrm[flat] = (128, 128, 255)

    rgb = (to_srgb(col) * 255).round()
    rgb[flat] = (40, 16, 12)  # keep mip-filtered edges blood-coloured instead of black
    rgba = np.dstack([rgb, alpha * 255]).round().clip(0, 255).astype(np.uint8)
    rough8 = (rough * 255).round().clip(0, 255).astype(np.uint8)
    rough8[flat] = 160
    return rgba, nrm, rough8


# ---------------------------------------------------------------- blood: variants

def spatter(n, seed):
    """Impact spatter: a falling volume hits at a slight angle (travel towards +x): scalloped parent stain with crown
    spines, satellite droplets thrown radially (elongated with distance, tails pointing away from the impact),
    and a fine mist."""
    rng = np.random.default_rng(seed)
    fld = Field(n)
    hn = fbm(n, seed + 10, beta=1.6, fmin=6)
    cx, cy, r0 = n * 0.40, n * 0.52, n * 0.085
    travel = math.radians(rng.uniform(-12, 12))
    nsp = 26
    spine_ang = np.sort(rng.uniform(0, 2 * math.pi, nsp))
    spine_len = rng.lognormal(-1.2, 0.5, nsp)
    # bias: spines and drops stronger in the travel direction (oblique impact)
    bias = lambda a: 1 + 0.9 * max(math.cos(a - travel), 0) ** 2
    ang_noise = rng.standard_normal(64)

    def parent(xx, yy):
        dx, dy = xx - cx, yy - cy
        rho = np.sqrt(dx * dx + dy * dy)
        th = np.arctan2(dy, dx)
        rr = np.ones_like(th)
        for k in range(1, 9):  # low-order wobble
            rr += 0.035 / k * (ang_noise[2 * k] * np.cos(k * th) + ang_noise[2 * k + 1] * np.sin(k * th))
        for a, l in zip(spine_ang, spine_len):
            d = np.angle(np.exp(1j * (th - a)))
            rr += l * bias(a) * np.exp(-(d / 0.045) ** 2)
        rr *= 1 + 0.25 * np.maximum(np.cos(th - travel), 0) ** 3  # elongated downrange
        return r0 * rr - rho + 2.5 * hn[yy.astype(int), xx.astype(int)]
    R = r0 * 2.6
    fld.stamp(cx - R, cy - R, cx + R, cy + R, parent, r0)
    # beads at the spine tips (fingers pinching off into droplets)
    for a, l in zip(spine_ang, spine_len):
        reach = r0 * (1 + l * bias(a) * 1.25) + rng.uniform(4, 18)
        rb = rng.uniform(4, 10) * (0.6 + l)
        fld.ellipse(cx + math.cos(a) * reach, cy + math.sin(a) * reach, rb * 1.3, rb, a, hn, 1.0)
    # satellites: count falls with distance; size ~ distance^-1; elongation and tails grow with distance
    for i in range(420):
        a = rng.choice(spine_ang) + rng.normal(0, 0.08) if rng.random() < 0.55 else rng.uniform(0, 2 * math.pi)
        if rng.random() < 0.5:  # downrange bias
            a = travel + rng.normal(0, 0.9)
        dist = r0 * (1.25 + rng.pareto(1.6) * 0.9) * bias(a) ** 0.5
        if dist > n * 0.58:
            continue
        x, y = cx + math.cos(a) * dist, cy + math.sin(a) * dist
        if not (8 < x < n - 8 and 8 < y < n - 8):
            continue
        size = np.clip(r0 * 0.22 * (r0 / dist) ** 1.05 * rng.lognormal(0, 0.45), 1.6, 34)
        elong = 1 + min((dist / r0 - 1) * 0.28 * rng.uniform(0.6, 1.4), 2.6)
        fld.ellipse(x, y, size * elong, size, a, hn, min(1.2, size * 0.15))
        if elong > 1.5 and size > 2.5:
            tl = size * elong * rng.uniform(0.8, 2.2)
            fld.tail(x, y, a, size * elong * 0.6, tl, size * 0.55, hn, 0.5)
            if rng.random() < 0.45:  # detached "exclamation" droplet beyond the tail
                gap = size * elong * 0.6 + tl + rng.uniform(3, 10)
                fld.ellipse(x + math.cos(a) * gap, y + math.sin(a) * gap, size * 0.45, size * 0.35, a)
    # mist: tiny dots, clustered downrange
    for i in range(900):
        a = travel + rng.normal(0, 1.2)
        dist = r0 * (1.1 + rng.exponential(2.2))
        x, y = cx + math.cos(a) * dist, cy + math.sin(a) * dist
        if 4 < x < n - 4 and 4 < y < n - 4:
            s = rng.uniform(0.9, 2.6)
            fld.ellipse(x, y, s * rng.uniform(1, 1.6), s, a)
    return finish_blood(fld.F, fld.S, n, seed, age=0.25, thick_px=22, rim_w=0.10, crack_cell=0, wet_bias=0.35)


def pool(n, seed):
    """Pooled stain: a soft union of lobes with large-scale wicking, satellite drips at the margin, a darker dried
    coffee-ring rim with tide lines, a still-glossy thick centre and shrinkage cracks in between."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    acc = np.zeros((n, n), np.float32)
    cx, cy = n * 0.5, n * 0.5
    lobes = [(cx, cy, n * 0.24)] + [(cx + rng.normal(0, n * 0.12), cy + rng.normal(0, n * 0.1), n * rng.uniform(0.06, 0.15)) for _ in range(7)]
    for x, y, r in lobes:  # metaballs: smooth union of fluid lobes
        acc += np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * r * r))
    iso = 0.5
    F = (acc - iso)
    gy, gx = np.gradient(acc)
    F = F / (np.sqrt(gx * gx + gy * gy) + 1e-4)  # metaball field -> approx distance in pixels
    F = np.clip(F, -200, 900)
    F += 34 * fbm(n, seed + 20, beta=2.6, fmin=2, fmax=40)          # lobe-scale meander
    F += 7 * fbm(n, seed + 21, beta=1.8, fmin=20, aniso=2.5)       # grain-direction wicking (along x)
    F += 1.8 * fbm(n, seed + 22, beta=1.0, fmin=60)                # fine ragged edge
    fld = Field(n)
    fld.F = F.astype(np.float32)
    fld.S = np.full((n, n), 90.0, np.float32)
    hn = fbm(n, seed + 23, beta=1.6, fmin=6)
    # drops that fell around the pool before/after it formed
    for i in range(40):
        a = rng.uniform(0, 2 * math.pi)
        d = n * rng.uniform(0.3, 0.46)
        s = rng.lognormal(1.6, 0.6)
        fld.ellipse(cx + math.cos(a) * d, cy + math.sin(a) * d * 0.9, s * rng.uniform(1, 1.3), s, rng.uniform(0, 3.14), hn, 0.8)
    return finish_blood(fld.F, fld.S, n, seed, age=0.05, thick_px=70, rim_w=0.2, rim_min=2, rim_max=18, crack_cell=48,
                        wet_bias=0.75)


def smear(n, seed):
    """Drag mark: a bloodied hand/piece pressed down (heavy deposit at the start) and dragged left to right; the
    deposit runs out along the stroke and breaks into parallel streaks with skips (finger and ridge tracks)."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    x0, x1 = n * 0.12, n * 0.92
    u = (xx - x0) / (x1 - x0)                                  # 0 at the start, 1 at the end of the stroke
    bend = n * 0.06 * np.sin(u * math.pi * 0.9 + 0.3) + n * 0.03 * u
    half = n * (0.15 - 0.045 * np.clip(u, 0, 1)) * (1 + 0.05 * np.sin(u * 7))
    v = (yy - n * 0.5 - bend) / half                           # -1..1 across the stroke
    wob = 0.04 * fbm(n, seed + 30, beta=3.0, fmin=1, fmax=6)
    vv = v + wob
    # streak profile across the stroke: 1D fractal ridges (bands of 4-40 px), sharpened
    k = np.arange(1, 160)
    rng_ph, rng_am = rng.uniform(0, 2 * math.pi, k.size), rng.standard_normal(k.size) / k ** 0.75
    vs = np.linspace(-1.6, 1.6, 4096)
    prof = (rng_am[None, :] * np.cos(np.outer(vs, k) * math.pi + rng_ph[None, :])).sum(1)
    prof = (prof - prof.mean()) / prof.std()
    streak = np.interp(vv, vs, prof).astype(np.float32)
    deposit = 1.8 * np.exp(-np.clip(u, 0, None) * 2.4) - 0.45   # runs out along the stroke
    deposit += 0.25 * fbm(n, seed + 31, beta=2.0, fmin=2, aniso=0.25)  # pressure changes (stretched along the stroke)
    side = 1 - smoothstep(0.75, 1.15, np.abs(vv))               # edges of the contact patch
    start = smoothstep(-0.03, 0.04, u) * (1 - smoothstep(0.97, 1.08, u))
    g = deposit + 0.55 * streak * smoothstep(0.02, 0.35, u)    # streaks only once dragging
    g = g * side * start - (1 - side * start) * 1.2
    g += 0.18 * fbm(n, seed + 32, beta=1.2, fmin=40, aniso=0.3)  # ragged streak edges
    F = g * 28.0
    # the initial contact: a dense pressed patch with a pooled lip on the leading edge
    pad = np.exp(-(((xx - x0 - n * 0.05) / (n * 0.07)) ** 2 + ((yy - n * 0.5 - bend) / (n * 0.13)) ** 2))
    F = np.maximum(F, (pad - 0.35) * 90 + 10 * fbm(n, seed + 33, beta=1.8, fmin=8))
    fld = Field(n)
    fld.F, fld.S = F.astype(np.float32), np.full((n, n), 30.0, np.float32)
    hn = fbm(n, seed + 34, beta=1.6, fmin=6)
    # flicked droplets off the trailing edge and a few cast-off tails
    for i in range(60):
        uu = rng.uniform(0.2, 1.0)
        x = x0 + uu * (x1 - x0) + rng.normal(0, 30)
        y = n * 0.5 + n * 0.06 * math.sin(uu * math.pi * 0.9 + 0.3) + n * 0.03 * uu + rng.choice([-1, 1]) * n * rng.uniform(0.12, 0.25)
        s = rng.lognormal(0.9, 0.5)
        fld.ellipse(x, y, s * 1.8, s, rng.normal(0, 0.25), hn, 0.6)
        if rng.random() < 0.4:
            fld.tail(x, y, rng.normal(0, 0.2), s, s * rng.uniform(3, 8), s * 0.6, hn, 0.4)
    ridge = 0.6 * smoothstep(0.3, 0.8, np.abs(streak)) * (F > 0)   # dried ridges along the streaks
    return finish_blood(fld.F, fld.S, n, seed, age=0.45, thick_px=30, rim_w=0.12, rim_max=6, crack_cell=0,
                        extra_h=ridge, wet_bias=0.3)


def drips(n, seed):
    """Runs from an overflowing edge (top of the decal = table/board edge): an uneven band, drips of varying width
    and length that wander slightly and end in a bead; some stop short, some merge."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    band_edge = n * 0.07 + n * 0.035 * fbm(n, seed + 40, beta=2.5, fmin=1, shape=(1, n))[0] + \
        n * 0.008 * fbm(n, seed + 41, beta=1.2, fmin=20, shape=(1, n))[0]
    F = (band_edge[None, :] - yy)
    fade = smoothstep(0.03, 0.15, xx / n) * (1 - smoothstep(0.85, 0.97, xx / n))
    F = np.where(F > 0, F * 0.6, F)
    F = F * fade - (1 - fade) * 40
    F[yy < n * 0.012] = np.minimum(F[yy < n * 0.012], -2)  # leave a sliver at the top so the decal edge is clean
    fld = Field(n)
    fld.F, fld.S = F.astype(np.float32), np.full((n, n), 26.0, np.float32)
    hn = fbm(n, seed + 42, beta=1.6, fmin=6)
    xs = np.sort(rng.uniform(n * 0.12, n * 0.88, 14))
    for x in xs:
        w = rng.uniform(7, 22)
        top = band_edge[int(x)] - 4
        length = rng.uniform(0.18, 0.86) * n * (w / 22) ** 0.5
        steps = int(length / 4)
        px = x
        drift = rng.normal(0, 0.15)
        for s in range(steps):  # the run thins and wanders as it drains, then pinches off into a bead
            t = s / max(steps - 1, 1)
            px += drift + rng.normal(0, 0.35)
            ww = w * (1 - 0.45 * t) * (1 + 0.12 * math.sin(s * 0.21 + x))
            fld.ellipse(px, top + s * 4, ww * 0.95, ww, math.pi / 2, hn, 0.8)
        bead = w * rng.uniform(1.25, 1.7)
        fld.ellipse(px, top + steps * 4 + bead * 0.35, bead * 1.15, bead, math.pi / 2, hn, 0.8)
    # spatter flecks on the face
    for i in range(70):
        s = rng.lognormal(0.6, 0.5)
        fld.ellipse(rng.uniform(n * 0.08, n * 0.92), rng.uniform(n * 0.1, n * 0.95), s * 1.3, s, math.pi / 2 + rng.normal(0, 0.3), hn, 0.4)
    return finish_blood(fld.F, fld.S, n, seed, age=0.35, thick_px=12, rim_w=0.18, rim_max=5, crack_cell=0, wet_bias=0.4)


# ---------------------------------------------------------------- handling grime (tileable)

def _wrap_stamp(dst, patch, x, y, op=np.maximum):
    """Combine `patch` into `dst` at (x, y) with wrap-around, so the result tiles."""
    n = dst.shape[0]
    ph, pw = patch.shape
    ys = (np.arange(ph) + int(y)) % n
    xs = (np.arange(pw) + int(x)) % n
    dst[np.ix_(ys, xs)] = op(dst[np.ix_(ys, xs)], patch)


def fingerprint(size, rng):
    """One latent print: loop/whorl ridges (~0.45 mm pitch, here 8-11 px), partial contact, slight slide."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size - 0.5
    ang = rng.uniform(0, 2 * math.pi)
    ca, sa = math.cos(ang), math.sin(ang)
    u, v = xx * ca + yy * sa, -xx * sa + yy * ca
    core = (rng.normal(0, 0.05), rng.normal(0.05, 0.05))
    du, dv = u - core[0], (v - core[1]) * 1.35
    pitch = rng.uniform(8, 11) / size
    kind = rng.random()
    if kind < 0.6:  # loop: concentric arcs opening downwards
        phase = np.sqrt(du ** 2 + np.maximum(dv, 0) ** 2) + 0.35 * np.minimum(dv, 0) ** 2 / (np.abs(du) + 0.08)
    elif kind < 0.85:  # whorl
        phase = np.sqrt(du ** 2 + dv ** 2) + 0.012 * np.arctan2(dv, du)
    else:  # arch
        phase = dv + 0.6 * np.exp(-(du / 0.18) ** 2) * 0.15
    noise = rng.standard_normal((size // 8 + 2, size // 8 + 2))
    noise = ndimage.zoom(ndimage.gaussian_filter(noise, 1.2), 8, order=1)[:size, :size]
    ridges = 0.5 + 0.5 * np.cos(2 * math.pi * (phase + 0.004 * noise) / pitch)
    ridges = smoothstep(0.35, 0.75, ridges)
    pad = np.sqrt((u / 0.36) ** 2 + (v / 0.46) ** 2)
    contact = smoothstep(1.0, 0.55, pad) * smoothstep(-0.6, 0.4, noise + rng.normal(0, 0.3))  # partial prints
    p = ridges * contact
    if rng.random() < 0.35:  # slid while touching: smear along a direction
        p = ndimage.uniform_filter1d(p, int(rng.uniform(6, 22)), axis=int(rng.integers(0, 2)))
    return p.astype(np.float32)


def grime(n, seed):
    rng = np.random.default_rng(seed)
    # R smudges: broad thumb-wipe patches, slightly directional, with soft greasy edges
    sm = fbm(n, seed + 50, beta=2.8, fmin=2, fmax=40)
    wipe = fbm(n, seed + 51, beta=2.2, fmin=4, aniso=0.35)
    smudge = smoothstep(0.1, 1.6, sm + 0.45 * wipe)
    smudge = np.clip(smudge * (0.75 + 0.25 * fbm(n, seed + 52, beta=1.0, fmin=40)), 0, 1)

    # G scratches: power-law lengths, mostly straight with gentle curvature, a few parallel clusters (sliding)
    ss = 2
    img = Image.new("L", (n * ss, n * ss), 0)
    dr = ImageDraw.Draw(img)

    def line(x, y, ang, length, width, val):
        pts, a = [], ang
        for t in np.linspace(0, length, max(int(length / 12), 2)):
            a += rng.normal(0, 0.01)
            pts.append((x + math.cos(a) * t, y + math.sin(a) * t))
        for ox in (-n * ss, 0, n * ss):  # draw wrapped copies so the map tiles
            for oy in (-n * ss, 0, n * ss):
                dr.line([(px + ox, py + oy) for px, py in pts], fill=val, width=width)
    for i in range(700):
        line(rng.uniform(0, n * ss), rng.uniform(0, n * ss), rng.uniform(0, 2 * math.pi),
             min(n * ss * 0.6, 20 * ss * (1 + rng.pareto(1.3))), int(rng.choice([1, 1, 1, 2, 2, 3])), int(rng.uniform(60, 255)))
    for c in range(12):  # sliding clusters: near-parallel sets
        x, y, a = rng.uniform(0, n * ss), rng.uniform(0, n * ss), rng.uniform(0, 2 * math.pi)
        for j in range(int(rng.integers(5, 16))):
            line(x + rng.normal(0, 40), y + rng.normal(0, 40), a + rng.normal(0, 0.03), rng.uniform(80, 500) * ss, 1, int(rng.uniform(70, 200)))
    scratches = np.asarray(img.resize((n, n), Image.LANCZOS), np.float32) / 255

    # B fingerprints: scattered latent prints, denser in a few handling zones
    fp = np.zeros((n, n), np.float32)
    for i in range(70):
        s = int(rng.uniform(220, 330))
        _wrap_stamp(fp, fingerprint(s, rng) * rng.uniform(0.35, 1.0), rng.uniform(0, n), rng.uniform(0, n))

    # A lacquer chips: flakes with sharp, angular borders (warped Voronoi cells), size power law
    chips = np.zeros((n, n), np.float32)
    lab_noise = fbm(n, seed + 53, beta=1.5, fmin=8)
    for i in range(260):
        s = int(np.clip(8 * (1 + rng.pareto(1.5)), 8, 140))
        yy, xx = np.mgrid[0:s * 2, 0:s * 2].astype(np.float32) - s
        a = rng.uniform(0, 2 * math.pi)
        k = int(rng.integers(5, 9))
        th = np.arctan2(yy, xx)
        rr = np.sqrt(xx ** 2 + yy ** 2)
        radii = s * 0.5 * rng.uniform(0.55, 1.0, k)
        idx = ((th - a) % (2 * math.pi)) / (2 * math.pi) * k
        i0 = idx.astype(int) % k
        t = idx - np.floor(idx)
        rad = radii[i0] * (1 - t) + radii[(i0 + 1) % k] * t  # polygon-ish flake
        x, y = rng.uniform(0, n), rng.uniform(0, n)
        ln = lab_noise[(yy.astype(int) + int(y)) % n, (xx.astype(int) + int(x)) % n]
        flake = smoothstep(0.0, 1.0, rad - rr + 1.5 * ln)
        _wrap_stamp(chips, flake, x - s, y - s)
    packed = np.dstack([smudge, scratches, fp, chips])

    # detail height: scratches cut in, chips are a step down through the lacquer, ridges a hair proud
    h = -scratches * 1.2 - chips * 2.0 + fp * 0.25 + 0.15 * fbm(n, seed + 54, beta=1.0, fmin=80)
    h = ndimage.gaussian_filter(h, 0.6, mode="wrap")
    return packed, height_to_normal(h, 2.0, wrap=True)


# ---------------------------------------------------------------- preview

def load_wood(wood_dir, slug, n):
    p = os.path.join(wood_dir or "", slug, f"{slug}_diff.jpg") if wood_dir else ""
    if p and os.path.exists(p):
        im = Image.open(p).convert("RGB").resize((n, n), Image.LANCZOS)
        return np.asarray(im, np.float32) / 255
    # fallback: procedural grain so the sheet renders without Poly Haven files
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
    g = 0.5 + 0.5 * np.sin((yy * 40 + 0.4 * fbm(n, 3, beta=2.5, fmin=1, aniso=0.2)) * math.pi)
    base = np.array([0.62, 0.48, 0.33]) if "maple" in slug else np.array([0.25, 0.14, 0.08])
    return (base[None, None] * (0.8 + 0.25 * g[..., None])).astype(np.float32)


def shade(bg_srgb, rgba, nrm, rough, light=(-0.45, 0.55, 0.7)):
    """Composite a decal over a background and light it (Lambert + GGX-ish specular) to judge shape and sheen."""
    a = rgba[..., 3:4] / 255.0
    lin_bg = np.power(bg_srgb, 2.2)
    lin_fg = np.power(rgba[..., :3] / 255.0, 2.2)
    alb = lin_bg * (1 - a) + lin_fg * a
    # tangent space with y = up the image; DirectX stores green = -y, so flip it. light: from the top-left
    Nimg = nrm.astype(np.float32) / 127.5 - 1
    Nimg[..., 1] *= -1
    L = np.array(light) / np.linalg.norm(light)
    V = np.array([0, 0, 1.0])
    H = (L + V) / np.linalg.norm(L + V)
    ndl = np.clip((Nimg * L).sum(-1), 0, 1)[..., None]
    r = (rough.astype(np.float32) / 255)[..., None] * a + 0.7 * (1 - a)
    al2 = np.maximum(r ** 4, 1e-4)
    ndh = np.clip((Nimg * H).sum(-1), 0, 1)[..., None]
    D = al2 / (math.pi * (ndh ** 2 * (al2 - 1) + 1) ** 2)
    spec = 0.04 * D * ndl * 0.25
    col = alb * (0.18 + 1.1 * ndl) + spec
    return (np.clip(np.power(np.clip(col, 0, 1), 1 / 2.2), 0, 1) * 255).astype(np.uint8)


def contact_sheet(path, results, grime_maps, wood_dir, cell=512):
    light = load_wood(wood_dir, "white_maple_veneer", 2048)
    dark = load_wood(wood_dir, "dark_wood", 2048)
    names = list(results)
    W = Image.new("RGB", (cell * 4, cell * 4 + 4 * 22), (12, 12, 12))
    d = ImageDraw.Draw(W)

    def put(im, col, row, label):
        x, y = col * cell, row * (cell + 22)
        W.paste(Image.fromarray(im).resize((cell, cell), Image.LANCZOS), (x, y))
        d.text((x + 6, y + cell + 5), label, fill=(220, 220, 220))
    for i, nm in enumerate(names):
        rgba, nrm, rough = results[nm]
        put(shade(light, rgba, nrm, rough), i, 0, f"{nm}: lit over maple")
        put(shade(dark, rgba, nrm, rough), i, 1, f"{nm}: lit over dark wood")
    # row 3: closeups at native resolution (1:1 crops) to judge edge detail
    for i, nm in enumerate(names):
        rgba, nrm, rough = results[nm]
        lit = shade(light, rgba, nrm, rough)
        cy, cx = {"spatter": (900, 1050), "pool": (420, 760), "smear": (850, 1350), "drips": (120, 600)}.get(nm, (768, 768))
        put(lit[cy:cy + cell, cx:cx + cell], i, 2, f"{nm}: 1:1 crop")
    packed, gn = grime_maps
    for i, (lab, ch) in enumerate((("grime R smudges", 0), ("grime G scratches", 1), ("grime B fingerprints", 2))):
        put((packed[..., ch] * 255).astype(np.uint8)[:1024, :1024], i, 3, lab + " (half tile)")
    put(gn[:1024, :1024], 3, 3, "grime detail normal (half tile)")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    W.save(path, optimize=True)


# ---------------------------------------------------------------- main

def save_png(arr, path, mode=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(arr, mode).save(path, optimize=True, compress_level=9)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.abspath(os.path.join(here, "..", "..", ".."))
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(repo, "ue5", "assets", "textures"))
    ap.add_argument("--sheet", default=os.path.join(repo, "docs", "screenshots", "assets", "blood-sheet.png"))
    ap.add_argument("--wood", default=None, help="folder with Poly Haven textures/<slug>/ (preview background only)")
    ap.add_argument("--size", type=int, default=2048)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--only", default=None, help="comma list of variants (spatter,pool,smear,drips,grime)")
    a = ap.parse_args()
    n = a.size
    want = set((a.only or "spatter,pool,smear,drips,grime").split(","))
    results = {}
    for k, (name, fn) in enumerate((("spatter", spatter), ("pool", pool), ("smear", smear), ("drips", drips))):
        if name not in want:
            continue
        rgba, nrm, rough = fn(n, a.seed + 100 * k)
        results[name] = (rgba, nrm, rough)
        base = os.path.join(a.out, "blood", f"T_Blood_{name.capitalize()}")
        save_png(rgba, base + "_BaseColor.png", "RGBA")
        save_png(nrm, base + "_Normal.png", "RGB")
        save_png(rough, base + "_Roughness.png", "L")
        print("blood", name, flush=True)
    gm = None
    if "grime" in want:
        packed, gn = grime(n, a.seed + 900)
        save_png((packed * 255).round().clip(0, 255).astype(np.uint8), os.path.join(a.out, "grime", "T_HandlingGrime_Mask.png"), "RGBA")
        save_png(gn, os.path.join(a.out, "grime", "T_HandlingGrime_Normal.png"), "RGB")
        gm = (packed, gn)
        print("grime", flush=True)
    if a.sheet and len(results) == 4 and gm:
        contact_sheet(a.sheet, results, gm, a.wood)
        print("sheet", a.sheet, flush=True)


if __name__ == "__main__":
    main()
