"""synth_sfx.py [name ...] -> raw/<name>.flac, then finish with finish_sfx.py like any generated take.

Some effects LTX-2.3 could not make (it renders sharp, sparse sounds as a steady wash): these are built from filtered
noise instead, with seeded randomness so a re-run gives the same files.
  musket_s   a ragged volley of eight to ten black-powder muskets over the water
  sail_s     canvas luffing in the wind, then filling with a crack
  quill_s    two quick strokes of a quill on parchment (chart moves)
  page_s     a heavy logbook page turned and laid flat
"""
import os, sys
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "raw")


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)


def lp(x, f, order=2):
    return sosfilt(butter(order, f, btype="low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, btype="high", fs=SR, output="sos"), x)


def decay(n, tau, attack=0.0):
    t = np.arange(n) / SR
    e = np.exp(-t / tau)
    if attack > 0:
        e *= np.minimum(1, t / attack)
    return e


def reverb(x, rng, secs=1.2, tau=0.25, mix=0.25, cutoff=2500):
    n = int(secs * SR)
    ir = lp(rng.standard_normal(n), cutoff) * decay(n, tau)
    ir[0] = 0
    wet = np.convolve(x, ir)[: len(x)]
    wet *= np.abs(x).max() / (np.abs(wet).max() + 1e-9)
    return x + mix * wet


def musket(rng, secs=2.2):
    out = np.zeros(int(secs * SR))
    shots = rng.integers(8, 11)
    times = np.sort(rng.uniform(0.0, 0.9, shots) ** 1.3)  # bunched at the start, on the word "fire!", then stragglers
    for t0 in times:
        n = int(0.9 * SR)
        g = rng.uniform(0.45, 1.0)
        crack = hp(rng.standard_normal(n), rng.uniform(1500, 2500)) * decay(n, rng.uniform(0.006, 0.012), 0.0006)
        body = bp(rng.standard_normal(n), 90, rng.uniform(500, 900)) * decay(n, rng.uniform(0.05, 0.09), 0.002) * 3.0
        tail = lp(rng.standard_normal(n), 1800) * decay(n, rng.uniform(0.18, 0.3), 0.01) * 0.35
        shot = g * (crack + body + tail)
        i = int(t0 * SR)
        out[i:i + n] += shot[: len(out) - i]
    out = reverb(out, rng, secs=1.6, tau=0.35, mix=0.35, cutoff=1800)
    return out


def sail(rng, secs=1.9):
    n = int(secs * SR)
    t = np.arange(n) / SR
    wind = lp(rng.standard_normal(n), 900) * 0.15 * (0.6 + 0.4 * np.sin(2 * np.pi * 0.7 * t))
    # irregular flutter: a train of soft whumps that speeds up then stops when the sail fills
    flap = np.zeros(n)
    tt = 0.05
    while tt < 1.15:
        m = int(0.12 * SR)
        w = bp(rng.standard_normal(m), 70, rng.uniform(450, 800)) * decay(m, rng.uniform(0.02, 0.04), 0.004)
        i = int(tt * SR)
        flap[i:i + m] += rng.uniform(1.2, 3.0) * w
        tt += rng.uniform(0.055, 0.11)
    flap *= np.clip(t / 0.3, 0, 1)
    m = int(0.7 * SR)
    fill = (bp(rng.standard_normal(m), 60, 1400) * decay(m, 0.07, 0.003) * 2.0
            + hp(rng.standard_normal(m), 1800) * decay(m, 0.012, 0.0005) * 0.25)
    i = int(1.22 * SR)
    flap[i:i + m] += fill[: n - i]
    return reverb(wind + flap, rng, secs=0.6, tau=0.08, mix=0.15, cutoff=3000)


def quill(rng, secs=0.85):
    n = int(secs * SR)
    out = np.zeros(n)
    for start, length in ((0.02, 0.26), (0.38, 0.34)):
        m = int(length * SR)
        t = np.arange(m) / SR
        grains = (rng.random(m) < 260 / SR) * rng.uniform(0.3, 1, m)
        grains = np.convolve(grains, np.hanning(40), "same")
        hiss = bp(rng.standard_normal(m), 2200, 7500) * 0.35
        scratch = bp(rng.standard_normal(m), 1500, 6000) * (0.4 + grains * 3)
        env = np.sin(np.pi * np.clip(t / length, 0, 1)) ** 0.6
        i = int(start * SR)
        out[i:i + m] += (hiss + scratch) * env
    return out


def page(rng, secs=0.9):
    n = int(secs * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    # a swish whose brightness sweeps up and down as the page lifts and falls
    swish = np.zeros(n)
    for lo, hi, w in ((500, 1500, 1.0), (1500, 4000, 0.8), (4000, 9000, 0.35)):
        swish += w * bp(noise, lo, hi)
    env = np.exp(-((t - 0.32) / 0.13) ** 2)
    crinkle = (rng.random(n) < 90 / SR) * rng.uniform(0.2, 1, n)
    crinkle = bp(np.convolve(crinkle, np.hanning(60), "same"), 1200, 6000) * 6 * np.exp(-((t - 0.3) / 0.2) ** 2)
    m = int(0.25 * SR)
    flop = np.zeros(n)
    flop[int(0.55 * SR):int(0.55 * SR) + m] = bp(rng.standard_normal(m), 80, 600) * decay(m, 0.045, 0.004) * 4.0
    return swish * env + crinkle + flop


MAKERS = {"musket_s": (musket, 1711), "sail_s": (sail, 1701), "quill_s": (quill, 1761), "page_s": (page, 1771)}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name in sys.argv[1:] or MAKERS:
        fn, seed = MAKERS[name]
        y = fn(np.random.default_rng(seed))
        y = y / (np.abs(y).max() + 1e-9) * 0.7
        sf.write(os.path.join(OUT, name + ".flac"), y.astype(np.float32), SR)
        print("wrote", name, f"{len(y)/SR:.2f}s")
