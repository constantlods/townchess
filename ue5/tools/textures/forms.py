"""Patient-record sheets for TownChess's loose papers (our own work; fonts are the repo's OFL fonts).

An aged A4 form: yellowed paper with uneven toning, foxing spots and a fold crease, a typed WARD B header and field
labels (Courier Prime), handwritten entries (Patrick Hand) in faded ink, a tea ring. Output: <out>/forms/
T_PaperForm_BaseColor.jpg (1024 x 1448, sRGB).

Usage: tools/.venv/bin/python ue5/tools/textures/forms.py [--out ue5/assets/textures] [--seed 3]
"""
import argparse, os, random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from blood import fbm

W, H = 1024, 1448
NOTES = ["refuses meals. plays chess alone", "asks for the board again", "knight to f3 - repeats it",
         "no visitors. calm after 9pm", "sedated 02:10", "says the pieces move at night", "stopped talking",
         "won every game this week", "do not let him keep the king"]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    fonts = os.path.join(here, "..", "..", "assets", "fonts")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(here, "..", "..", "assets", "textures"))
    ap.add_argument("--seed", type=int, default=3)
    a = ap.parse_args()
    rng = random.Random(a.seed)

    # paper: warm yellowed base, toning towards the edges, low-frequency blotches, foxing spots
    tone = fbm(H, a.seed, beta=2.6, fmin=1, shape=(H, W)) * 0.5 + 0.5
    y, x = np.mgrid[0:H, 0:W]
    edge = np.minimum(np.minimum(x, W - x) / W, np.minimum(y, H - y) / H)
    age = 0.55 + 0.25 * tone + 0.35 * np.exp(-edge * 14)
    base = np.array([226, 214, 182], float)[None, None] - age[..., None] * np.array([38, 46, 60], float)
    fox = fbm(H, a.seed + 1, beta=1.0, fmin=40, shape=(H, W))
    base -= (np.clip(fox - 2.2, 0, 1) * 70)[..., None] * np.array([0.6, 0.8, 1.0])
    img = Image.fromarray(base.clip(0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img)

    typed = ImageFont.truetype(os.path.join(fonts, "CourierPrime-Bold.ttf"), 34)
    typed_s = ImageFont.truetype(os.path.join(fonts, "CourierPrime-Regular.ttf"), 26)
    hand = ImageFont.truetype(os.path.join(fonts, "PatrickHand-Regular.ttf"), 40)
    ink_t, ink_h = (52, 46, 40), (38, 44, 78)
    d.text((80, 70), "WARD B  -  PATIENT RECORD", fill=ink_t, font=typed)
    d.line((80, 120, W - 80, 120), fill=ink_t, width=2)
    fields = ["NAME", "No.", "ADMITTED", "DIAGNOSIS", "RESTRAINT", "OBSERVATIONS"]
    yy = 160
    for f in fields:
        d.text((80, yy), f + ":", fill=ink_t, font=typed_s)
        d.line((300, yy + 30, W - 80, yy + 30), fill=(120, 110, 95), width=1)
        yy += 64
    entries = ["J. --------", str(rng.randint(100, 999)) + "/B", "14.XI." + str(rng.randint(52, 61)),
               "obsessive - see notes", "mask, nights"]
    for i, e in enumerate(entries):
        d.text((320, 152 + 64 * i), e, fill=ink_h, font=hand)
    yy = 160 + 64 * len(fields) + 10
    for k in range(14):  # ruled observation lines with dated notes
        d.line((80, yy + 46, W - 80, yy + 46), fill=(150, 140, 120), width=1)
        if rng.random() < 0.7:
            d.text((90, yy), f"{rng.randint(1, 28):02d}/{rng.randint(1, 12):02d}  " + rng.choice(NOTES), fill=ink_h, font=hand)
        yy += 56
    # tea ring and a fold crease
    cx, cy, r = rng.randint(600, 860), rng.randint(900, 1250), rng.randint(90, 120)
    for k in range(6):
        d.ellipse((cx - r - k, cy - r - k, cx + r + k, cy + r + k), outline=(150 - 8 * k, 110 - 6 * k, 70 - 4 * k), width=2)
    img = img.filter(ImageFilter.GaussianBlur(0.6))  # ink bleeding into the paper
    arr = np.asarray(img).astype(float)
    crease = np.exp(-((y - H * 0.5) / 3.0) ** 2) * 28 + np.exp(-((y - H * 0.5 - 4) / 6.0) ** 2) * -10
    arr -= crease[..., None]
    out = os.path.join(a.out, "forms")
    os.makedirs(out, exist_ok=True)
    Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGB").save(os.path.join(out, "T_PaperForm_BaseColor.jpg"), quality=92)
    print("form written", flush=True)


if __name__ == "__main__":
    main()
