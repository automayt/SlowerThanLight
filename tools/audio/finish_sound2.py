"""finish_sound2.py [name ...] -> out_v2/<name>.ogg

Finishes the takes chosen in picks.json (see pick_sound2.py):
- music: finish_music.py (loop point matched on onsets and harmony, -18 LUFS, stereo Vorbis 112k);
- sting: starts on the first onset, fades out, stereo Vorbis 112k at a set RMS;
- amb: the steadiest stretch, equal-power crossfaded tail-into-head for a seamless loop, stereo Vorbis 80k;
- sfx: finish_sfx.process (onset-aligned window, tail trimmed, RMS set, -1 dBFS peak), mono Vorbis.
Output goes to out_v2/ (gitignored) and is copied into public/audio when merged.
"""
import json, os, subprocess, sys
import numpy as np
import soundfile as sf
from finish_sfx import process, env, db, FFMPEG

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw", "v2")
OUT = os.path.join(HERE, "out_v2")
os.makedirs(OUT, exist_ok=True)

# sfx: dur (max seconds kept), rms dBFS
SFX = {
    "cannon-heavy": (2.6, -13), "cannon": (2.0, -14), "hit-wood": (1.4, -15), "splash": (1.8, -17),
    "chain": (1.8, -17), "grape": (1.6, -16), "hotshot": (1.8, -19), "crit": (1.6, -14), "mast": (3.5, -16),
    "flood": (2.5, -19), "pump": (2.2, -20), "hiss": (2.0, -19), "swords": (0.9, -16), "grapple": (2.0, -18),
    "boarders": (2.6, -17), "musket": (2.0, -16), "breach": (1.8, -16), "explosion": (3.5, -13), "fire": (2.0, -19),
    "sink": (4.5, -18), "cheer": (3.2, -18), "bell": (3.0, -18), "sail": (2.0, -19), "anchor": (3.0, -18),
    "creak": (2.5, -22), "waves": (3.0, -19), "gulls": (3.0, -21), "thunder": (4.5, -15), "coins": (1.4, -19),
    "dice": (1.6, -19), "tankard": (1.3, -19), "heal": (1.6, -21), "hammer": (1.6, -18), "recruit": (1.6, -19),
    "chart": (1.5, -21), "quill": (1.2, -23), "page": (1.0, -22), "click": (0.3, -22), "hover": (0.2, -28),
    "confirm": (0.5, -21), "cancel": (0.5, -22),
}


def spec(name):
    for k in sorted(SFX, key=len, reverse=True):
        if name == k or name.startswith(k + "-"):
            return SFX[k]
    raise SystemExit("no sfx spec for " + name)


def encode(y, sr, out, kbps, channels):
    tmp = out + ".wav"
    sf.write(tmp, y, sr, subtype="PCM_16")
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", tmp, "-ac", str(channels), "-ar", "44100",
                    "-c:a", "libvorbis", "-b:a", f"{kbps}k", out], check=True)
    os.remove(tmp)
    z, zsr = sf.read(out, always_2d=True)
    return dict(dur=round(len(z) / zsr, 2), peak_db=round(db(np.abs(z).max()), 1),
                rms_db=round(db(np.sqrt(np.mean(z ** 2))), 1), kb=round(os.path.getsize(out) / 1024, 1))


def level(y, rms, peak=-1.0):
    y = y * 10 ** ((rms - db(np.sqrt(np.mean(y ** 2)))) / 20)
    pk = np.abs(y).max()
    if pk > 10 ** (peak / 20):
        y = y * (10 ** (peak / 20) / pk)
    return y


def limit(y, sr, rms, max_boost=8.0, ceiling=-2.0):
    """Make up the loudness a peaky effect lost to the peak ceiling: boost by up to max_boost dB, then pull the peaks
    back under the ceiling with a smooth gain envelope (instant attack, 80 ms release) instead of scaling it all down."""
    short = rms - db(np.sqrt(np.mean(y ** 2)))
    if short <= 1:
        return y
    y = y * 10 ** (min(short, max_boost) / 20)
    thr = 10 ** (ceiling / 20)
    want = np.minimum(1.0, thr / np.maximum(np.abs(y), 1e-9))
    g = np.empty_like(want)
    rel = np.exp(-1 / (0.08 * sr))
    cur = 1.0
    for i, w in enumerate(want):
        cur = w if w < cur else w + (cur - w) * rel
        g[i] = cur
    # look ahead 2 ms so the gain is already down when a transient arrives
    la = int(0.002 * sr)
    g = np.minimum(g, np.concatenate([g[la:], np.ones(la)]))
    return y * g


def sting(y, sr):
    y = y - y.mean(0)
    e = env(y.mean(1), sr)
    on = np.where(e > e.max() * 10 ** (-30 / 20))[0][0]
    y = y[max(0, on - int(0.01 * sr)):]
    e = env(y.mean(1), sr)
    tail = np.where(e > e.max() * 10 ** (-48 / 20))[0][-1]
    y = y[: tail + 1].copy()
    f_out = min(len(y) // 4, int(0.8 * sr))
    y[-f_out:] *= (np.linspace(1, 0, f_out) ** 2)[:, None]
    y[: int(0.004 * sr)] *= np.linspace(0, 1, int(0.004 * sr))[:, None]
    return level(y, -16)


def amb(y, sr, dur):
    y = y - y.mean(0)
    n, xf = int(dur * sr), int(2.0 * sr)
    need = n + xf
    if len(y) < need:
        n = len(y) - xf; need = len(y)
    e = env(y.mean(1), sr)
    best, bi = None, 0
    for i in range(0, len(y) - need + 1, int(0.25 * sr)):
        seg = e[i:i + need]
        sc = seg.std() / (seg.mean() + 1e-9)
        if best is None or sc < best:
            best, bi = sc, i
    seg = y[bi:bi + need].copy()
    body, tail = seg[:n].copy(), seg[n:]
    t = np.linspace(0, np.pi / 2, xf)[:, None]
    body[:xf] = body[:xf] * np.sin(t) + tail * np.cos(t)
    return level(body, -24, peak=-3)


if __name__ == "__main__":
    picks = json.load(open(os.path.join(HERE, "picks.json")))
    want = set(sys.argv[1:])
    for fname, take in picks.items():
        meta = json.load(open(os.path.join(RAW, take + ".json")))
        if want and fname not in want and meta["name"] not in want:
            continue
        kind, src, out = meta["kind"], os.path.join(RAW, take), os.path.join(OUT, fname + ".ogg")
        if kind == "music":
            r = subprocess.run([sys.executable, os.path.join(HERE, "finish_music.py"), src, out, "--start", "1.0",
                                "--kbps", "112", "--maxkb", "2600"], capture_output=True, text=True)
            print(fname, "music", (r.stdout + r.stderr).strip().replace("\n", " | ")[-400:], flush=True)
            continue
        y, sr = sf.read(src, always_2d=True)
        if kind == "sting":
            info = encode(sting(y, sr), sr, out, 112, 2)
        elif kind == "amb":
            info = encode(amb(y, sr, meta["seconds"] - 6), sr, out, 80, 2)
        else:
            d, rms = spec(fname)
            info = encode(limit(process(y.mean(1), sr, dict(dur=d, loop=False, rms=rms)), sr, rms), sr, out, 80, 1)
        print(fname, kind, info, flush=True)
