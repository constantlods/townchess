"""The reference's painted "WARD B" wall sign (our own work; the font is the repo's OFL Courier Prime Bold).

Hand-painted stencil lettering on plaster: "WARD" over a large "B" and a double-headed arrow, dark grey paint that has
worn and flaked off (fractal erosion, more at the edges of the strokes), brush streaks along the strokes and a few
runs below the letters. A decal texture (board/environment C8b): RGBA, rgb = paint colour, a = paint coverage.
Output: <out>/signs/T_WardSign_BaseColor.png (1024 x 1024, sRGB, straight alpha).

Usage: tools/.venv/bin/python ue5/tools/textures/ward_sign.py [--out ue5/assets/textures] [--seed 11]
"""
import argparse, os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from blood import fbm, smoothstep

N = 1024


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    fonts = os.path.join(here, "..", "..", "assets", "fonts")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(here, "..", "..", "assets", "textures"))
    ap.add_argument("--seed", type=int, default=11)
    a = ap.parse_args()

    # paint mask, drawn at 2x and filtered down (soft brush edges)
    S = 2 * N
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    big = ImageFont.truetype(os.path.join(fonts, "CourierPrime-Bold.ttf"), 560)
    huge = ImageFont.truetype(os.path.join(fonts, "CourierPrime-Bold.ttf"), 720)

    def centred(text, font, y, dx=0):
        l, t, r, b = d.textbbox((0, 0), text, font=font)
        d.text(((S - (r - l)) / 2 - l + dx, y - t), text, fill=255, font=font)
        return b - t

    centred("WARD", big, 120)
    centred("B", huge, 660, dx=-30)
    # double-headed arrow under the B (the reference's "<->" way-finding arrow)
    y0, x0, x1, w = 1480, 600, 1450, 50
    d.rectangle((x0 + 90, y0 - w // 2, x1 - 90, y0 + w // 2), fill=255)
    d.polygon([(x0, y0), (x0 + 150, y0 - 105), (x0 + 150, y0 + 105)], fill=255)
    d.polygon([(x1, y0), (x1 - 150, y0 - 105), (x1 - 150, y0 + 105)], fill=255)
    mask = np.asarray(m.filter(ImageFilter.GaussianBlur(3.0)).resize((N, N), Image.LANCZOS)).astype(np.float32) / 255.0

    # runs: a few paint drips from the bottoms of strokes
    rng = np.random.default_rng(a.seed)
    runs = np.zeros_like(mask)
    cols = np.where(mask[int(N * 0.62):int(N * 0.72)].max(axis=0) > 0.9)[0]
    for x in rng.choice(cols, size=min(7, len(cols)), replace=False):
        ys = np.where(mask[:, x] > 0.9)[0]
        ys = ys[ys < int(N * 0.75)]
        if not len(ys):
            continue
        y_end = ys.max()
        length = int(rng.uniform(18, 70))
        wdt = rng.uniform(1.5, 3.2)
        yy = np.arange(y_end, min(N, y_end + length))
        taper = 1.0 - (yy - y_end) / max(length, 1)
        for dx in range(-4, 5):
            if 0 <= x + dx < N:
                runs[yy, x + dx] = np.maximum(runs[yy, x + dx], np.exp(-(dx / wdt) ** 2) * (0.4 + 0.6 * taper))
    paint = np.maximum(mask, runs * 0.85)

    # wear: flaked patches (coarse fbm), pitting (fine fbm), stronger near the stroke edges
    coarse = fbm(N, a.seed + 1, beta=2.4, fmin=3)
    fine = fbm(N, a.seed + 2, beta=1.2, fmin=60)
    edge = 1.0 - smoothstep(0.55, 1.0, np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), np.float32) / 255.0)
    keep = smoothstep(-1.1, -0.45, coarse) * smoothstep(-2.4, -1.6, fine - edge * 1.2)
    alpha = np.clip(paint * keep, 0, 1) * 0.92

    # paint colour: dark grey-brown, brush streaks along the horizontal strokes, lighter where thin
    streak = fbm(N, a.seed + 3, beta=1.6, fmin=8, aniso=6.0)
    base = np.array([46, 44, 41], np.float32)[None, None] * (1.0 + 0.12 * streak[..., None]) + (1.0 - alpha[..., None]) * 18.0
    rgba = np.dstack([base.clip(0, 255), (alpha * 255).clip(0, 255)]).astype(np.uint8)
    out = os.path.join(a.out, "signs")
    os.makedirs(out, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(os.path.join(out, "T_WardSign_BaseColor.png"), optimize=True)
    print("ward sign written, coverage", round(float(alpha.mean()), 3), flush=True)


if __name__ == "__main__":
    main()
