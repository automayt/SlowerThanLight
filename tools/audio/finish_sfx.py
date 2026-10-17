"""finish_sfx.py name[=rawstem] ... -> public/audio/<name>.ogg (+ manifest.json)

Per name (settings in SPEC): mono, cut a window of `dur` s around the loudest onset (one-shots)
or the steadiest stretch (loops), trim leading/trailing silence, normalise loudness, short fades
(loops get an equal-power crossfade of tail into head so they repeat seamlessly), then encode
Vorbis mono with ffmpeg and print duration / peak / RMS / size checks.
"""
import json, os, subprocess, sys
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
DEST = os.path.join(HERE, "..", "..", "public", "audio")
MAN = os.path.join(DEST, "manifest.json")
MODEL = ("LTX-2.3 22B dev fp8 + distilled LoRA 0.5 (joint audio-video model; audio track only), "
         "ComfyUI, 8-step euler_ancestral_cfg_pp")
try:
    import imageio_ffmpeg; FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FFMPEG = "ffmpeg"

# dur: target seconds; loop: seamless loop; rms: target RMS dBFS; kbps; maxkb
SPEC = {
    "cannon": dict(dur=1.5, loop=False, rms=-14, kbps=80, maxkb=60),
    "hit-wood": dict(dur=1.0, loop=False, rms=-15, kbps=80, maxkb=60),
    "splash": dict(dur=1.4, loop=False, rms=-17, kbps=80, maxkb=60, onset_db=12),
    "bell": dict(dur=2.3, loop=False, rms=-18, kbps=72, maxkb=60),
    "fire": dict(dur=3.0, loop=True, rms=-22, kbps=72, maxkb=400),
    "waves": dict(dur=10.0, loop=True, rms=-24, kbps=64, maxkb=400),
    "shanty": dict(dur=20.0, loop=True, rms=-18, kbps=80, maxkb=400),
    "click": dict(dur=0.35, loop=False, rms=-22, kbps=64, maxkb=20),
    "coins": dict(dur=1.2, loop=False, rms=-19, kbps=72, maxkb=50),
    "breach": dict(dur=1.6, loop=False, rms=-16, kbps=80, maxkb=60),
    "explosion": dict(dur=2.5, loop=False, rms=-13, kbps=80, maxkb=80),
    "boarders": dict(dur=2.0, loop=False, rms=-17, kbps=80, maxkb=70),
    "creak": dict(dur=8.0, loop=True, rms=-27, kbps=64, maxkb=300),
    # jobs4.json (LTX) and synth_sfx.py (musket, sail, quill, page)
    "sail": dict(dur=1.8, loop=False, rms=-19, kbps=72, maxkb=60),
    "musket": dict(dur=2.0, loop=False, rms=-16, kbps=80, maxkb=70),
    "cheer": dict(dur=3.0, loop=False, rms=-18, kbps=72, maxkb=90),
    "sink": dict(dur=3.8, loop=False, rms=-19, kbps=72, maxkb=100),
    "fanfare": dict(dur=4.0, loop=False, rms=-17, kbps=96, maxkb=110),
    "defeat": dict(dur=3.5, loop=False, rms=-18, kbps=96, maxkb=110),
    "quill": dict(dur=0.9, loop=False, rms=-24, kbps=64, maxkb=30),
    "page": dict(dur=0.9, loop=False, rms=-23, kbps=64, maxkb=30),
}


def spec_for(name):
    for k, v in SPEC.items():
        if name.startswith(k):
            return v
    raise SystemExit("no spec for " + name)


def db(x):
    return 20 * np.log10(max(float(x), 1e-12))


def env(y, sr, win=0.02):
    n = max(1, int(sr * win))
    e = np.sqrt(np.convolve(y * y, np.ones(n) / n, mode="same"))
    return e


def process(y, sr, s):
    y = y - y.mean()
    n = int(s["dur"] * sr)
    e = env(y, sr)
    thr = e.max() * 10 ** (-40 / 20)
    nz = np.where(e > thr)[0]
    if len(nz):
        y = y[max(0, nz[0] - int(0.01 * sr)): nz[-1] + 1]; e = env(y, sr)
    if not s["loop"]:
        # start just before the first strong onset (within onset_db, default 25 dB, of the max)
        on = np.where(e > e.max() * 10 ** (-s.get("onset_db", 25) / 20))[0][0]
        st = max(0, on - int(0.015 * sr))
        y = y[st: st + n]
        # trim the tail once it has decayed below -45 dB of the peak
        e = env(y, sr); tail = np.where(e > e.max() * 10 ** (-45 / 20))[0]
        y = y[: tail[-1] + 1]
        f_in, f_out = int(0.004 * sr), min(len(y) // 3, int(0.25 * sr))
        y[:f_in] *= np.linspace(0, 1, f_in)
        y[-f_out:] *= np.linspace(1, 0, f_out) ** 2
    else:
        xf = int(min(0.5, s["dur"] * 0.08) * sr)
        need = n + xf
        if len(y) < need:
            raise SystemExit(f"too short for loop: {len(y)/sr:.2f}s < {need/sr:.2f}s")
        # pick the window of length need whose loudness is steadiest
        best, bi = None, 0
        hop = int(0.25 * sr)
        for i in range(0, len(y) - need + 1, hop):
            seg = e[i:i + need]
            score = seg.std() / (seg.mean() + 1e-9)
            if best is None or score < best:
                best, bi = score, i
        seg = y[bi: bi + need].copy()
        body, tail = seg[:n].copy(), seg[n:]
        t = np.linspace(0, np.pi / 2, xf)
        body[:xf] = body[:xf] * np.sin(t) + tail * np.cos(t)
        y = body
    rms = np.sqrt(np.mean(y ** 2))
    y = y * 10 ** ((s["rms"] - db(rms)) / 20)
    pk = np.abs(y).max()
    if pk > 10 ** (-1 / 20):  # soft limit: scale down to -1 dBFS peak
        y = y * (10 ** (-1 / 20) / pk)
    return y.astype(np.float32)


def finalize(name, stem):
    s = spec_for(name)
    y, sr = sf.read(os.path.join(RAW, (stem or name) + ".flac"), always_2d=True)
    y = process(y.mean(axis=1), sr, s)
    os.makedirs(DEST, exist_ok=True)
    tmp = os.path.join(RAW, f"_{name}.wav")
    sf.write(tmp, y, sr, subtype="PCM_16")
    out = os.path.join(DEST, name + ".ogg")
    kb = s["kbps"]
    while True:
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-ar", "44100",
                        "-c:a", "libvorbis", "-b:a", f"{kb}k", out], check=True)
        if os.path.getsize(out) <= s["maxkb"] * 1024 or kb <= 48:
            break
        kb -= 8
    os.remove(tmp)
    # verify the encoded file
    z, zsr = sf.read(out, always_2d=True)
    z = z[:, 0]
    info = dict(dur=round(len(z) / zsr, 2), peak_db=round(db(np.abs(z).max()), 1),
                rms_db=round(db(np.sqrt(np.mean(z ** 2))), 1), kb=round(os.path.getsize(out) / 1024, 1), kbps=kb)
    assert info["peak_db"] > -20 and info["rms_db"] > -45, f"{name} looks silent: {info}"
    man = json.load(open(MAN)) if os.path.exists(MAN) else {"model": MODEL, "files": []}
    man["model"] = MODEL
    if name + ".ogg" not in man["files"]:
        man["files"].append(name + ".ogg")
    with open(MAN + ".tmp", "w", newline="\n") as f:
        json.dump(man, f, indent=2); f.write("\n")
    os.replace(MAN + ".tmp", MAN)
    return info


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        name, _, stem = arg.partition("=")
        print(name, finalize(name, stem or None), flush=True)
