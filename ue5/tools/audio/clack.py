"""Wooden chess-piece sounds (our own, synthesised): a felted piece set down on a wooden board.

    tools/.venv/bin/python ue5/tools/audio/clack.py [--out ue5/assets/sounds]

Modal synthesis: a short noise contact burst through a few decaying wood resonances (board ~180-420 Hz body,
piece ~1.2-3 kHz click), slight randomisation per variant. Writes 48 kHz 16-bit mono WAVs.
"""
import argparse, os, wave
import numpy as np

ap = argparse.ArgumentParser(); ap.add_argument("--out", default="ue5/assets/sounds"); a = ap.parse_args()
SR = 48000
rng = np.random.default_rng(5)


def knock(t0, gain, body=1.0, bright=1.0, dur=0.35):
    n = int(SR * dur)
    t = np.arange(n) / SR
    out = np.zeros(n)
    contact = rng.normal(0, 1, n) * np.exp(-t / 0.0012)                      # felt + wood contact transient
    modes = [(190, 0.09, 0.5 * body), (310, 0.06, 0.4 * body), (430, 0.045, 0.25 * body),
             (1250, 0.018, 0.35 * bright), (2100, 0.012, 0.3 * bright), (3150, 0.008, 0.18 * bright)]
    for f, tau, amp in modes:
        f *= rng.uniform(0.96, 1.04)
        out += amp * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / tau)
    out = out * (1 - np.exp(-t / 0.0004)) + 0.25 * contact
    pad = np.zeros(int(SR * t0))
    return gain * np.concatenate([pad, out])


def write(name, sig):
    sig = sig / max(np.abs(sig).max(), 1e-9) * 0.7
    fade = np.ones_like(sig); fade[-int(SR * 0.02):] = np.linspace(1, 0, int(SR * 0.02)); sig *= fade
    with wave.open(os.path.join(a.out, name), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((sig * 32767).astype(np.int16).tobytes())
    print("wrote", name, f"{len(sig) / SR:.2f}s")


os.makedirs(a.out, exist_ok=True)
write("S_TC_Move.wav", knock(0, 1.0))
cap = knock(0, 0.8, bright=1.3)                                   # the capturing piece lands...
second = knock(0.07, 0.6, body=0.6, bright=0.8)                   # ...and the taken piece knocks against it
m = max(len(cap), len(second)); write("S_TC_Capture.wav", np.pad(cap, (0, m - len(cap))) + np.pad(second, (0, m - len(second))))
