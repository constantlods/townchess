"""Ward ambience and the end-of-game sting (our own, synthesised; no samples).

    tools/.venv/bin/python ue5/tools/audio/ambience.py [--out ue5/assets/sounds]

S_TC_Ambience.wav  30 s seamless loop: ventilation (filtered brown noise with slow swell), a fluorescent tube's mains
                   hum (50 Hz and harmonics) with flicker, distant water drips (damped pings with a short room echo)
                   and two far metal creaks. The last second is crossfaded into the first so the loop has no seam.
S_TC_Sting.wav     4 s: a low swell (two detuned sines near 41 Hz), a dissonant cluster, then a struck-metal hit with a
                   long decay - for checkmate / resignation / time-out.
48 kHz 16-bit; ambience stereo (decorrelated), sting mono.
"""
import argparse, os, wave

import numpy as np

SR = 48000
rng = np.random.default_rng(13)


def lowpass(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):  # one-pole; fine for offline generation
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def brown(n):
    w = rng.normal(0, 1, n)
    b = np.cumsum(w)
    b -= np.convolve(b, np.ones(4801) / 4801, mode="same")  # remove drift
    return b / (np.abs(b).max() + 1e-9)


def drip(dur=0.9, f=None):
    n = int(SR * dur)
    t = np.arange(n) / SR
    f = f or rng.uniform(900, 1700)
    sweep = f * (1 + 0.6 * np.exp(-t / 0.01))                      # a drop's pitch falls as the bubble settles
    s = np.sin(2 * np.pi * np.cumsum(sweep) / SR) * np.exp(-t / 0.035)
    echo = np.zeros(n)
    for d, g in ((0.11, 0.35), (0.23, 0.18), (0.41, 0.08)):         # short tiled-room echoes
        k = int(d * SR)
        echo[k:] += g * s[:n - k]
    return (s + echo) * 0.5


def creak(dur=2.2):
    n = int(SR * dur)
    t = np.arange(n) / SR
    f0 = 70 + 25 * np.sin(2 * np.pi * 0.7 * t)                     # stick-slip friction: a rough, wavering pulse train
    ph = np.cumsum(f0) / SR
    pulses = (np.sin(2 * np.pi * ph) > 0.92).astype(float) * rng.uniform(0.5, 1, n)
    res = np.zeros(n)
    for fr, tau in ((420, 0.03), (980, 0.02), (1630, 0.012)):
        res += np.convolve(pulses, np.sin(2 * np.pi * fr * t[:2400]) * np.exp(-t[:2400] / tau), mode="same")
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    return res / (np.abs(res).max() + 1e-9) * env * 0.35


def ambience(seconds=30.0):
    n = int(SR * seconds)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for ch in range(2):
        vent = lowpass(brown(n), 380) * (0.55 + 0.15 * np.sin(2 * np.pi * t / 11 + ch))
        out[:, ch] += 0.18 * vent / (np.abs(vent).max() + 1e-9)
    flicker = 1 + 0.25 * (rng.random(n // 4800 + 1).repeat(4800)[:n] > 0.93)
    hum = sum(a * np.sin(2 * np.pi * f * t) for f, a in ((50, 0.5), (100, 0.35), (150, 0.18), (250, 0.06)))
    out += (0.02 * hum * flicker)[:, None]
    for _ in range(9):
        s = drip()
        k = rng.integers(0, n - len(s))
        pan = rng.uniform(0.2, 0.8)
        out[k:k + len(s), 0] += 0.05 * s * pan
        out[k:k + len(s), 1] += 0.05 * s * (1 - pan)
    for _ in range(2):
        s = creak()
        k = rng.integers(0, n - len(s))
        out[k:k + len(s), 0] += 0.06 * s
        out[k:k + len(s), 1] += 0.045 * s
    fade = int(SR * 1.0)                                            # seamless loop: blend the tail into the head
    w = np.linspace(0, 1, fade)[:, None]
    out[:fade] = out[:fade] * w + out[-fade:] * (1 - w)
    out = out[:-fade]
    return out / (np.abs(out).max() + 1e-9) * 0.6


def sting(seconds=4.0):
    n = int(SR * seconds)
    t = np.arange(n) / SR
    swell = (np.sin(2 * np.pi * 41 * t) + np.sin(2 * np.pi * 43.3 * t)) * np.clip(t / 1.2, 0, 1) * np.exp(-np.clip(t - 1.6, 0, None) / 1.2)
    cluster = sum(np.sin(2 * np.pi * f * t) for f in (220, 233.1, 246.9, 311.1)) * 0.12 * np.exp(-((t - 1.1) / 0.5) ** 2)
    hit = np.zeros(n)
    k = int(1.2 * SR)
    th = t[:n - k]
    for f, tau, a in ((182, 1.6, 0.6), (437, 1.1, 0.4), (873, 0.7, 0.3), (1529, 0.4, 0.2), (2655, 0.25, 0.12)):
        hit[k:] += a * np.sin(2 * np.pi * f * th) * np.exp(-th / tau)
    hit[k:] += rng.normal(0, 1, n - k) * np.exp(-th / 0.004) * 0.6
    out = 0.5 * swell + cluster + 0.55 * hit
    return out / (np.abs(out).max() + 1e-9) * 0.8


def write(path, x):
    x = np.clip(x, -1, 1)
    data = (x * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1 if x.ndim == 1 else x.shape[1])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print("wrote", path, f"{len(x) / SR:.1f}s", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="ue5/assets/sounds")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    write(os.path.join(a.out, "S_TC_Ambience.wav"), ambience())
    write(os.path.join(a.out, "S_TC_Sting.wav"), sting())
