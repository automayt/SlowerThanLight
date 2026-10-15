"""finish_title.py in.(flac|wav) out.ogg [max_seconds] -> looped, -16 LUFS, -1 dBFS peak, stereo Vorbis ~96k.

Loop: the tail is crossfaded (equal power, XF s) into the head. The cut point is searched in the last
few seconds for the offset whose onset envelope best matches the head's, so beats line up across the seam.
"""
import os, re, subprocess, sys, tempfile
import numpy as np
import soundfile as sf

FF = "ffmpeg"
XF = 1.5          # crossfade seconds
LUFS = -16.0
PEAK_DB = -1.0


def env(m, sr, win=0.01):
    hop = int(sr * win)
    n = len(m) // hop
    return np.sqrt((m[: n * hop].reshape(n, hop) ** 2).mean(1) + 1e-12), hop


def lufs(path):
    o = subprocess.run([FF, "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    i = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", o)[-1])
    p = float(re.findall(r"Peak:\s+(-?[\d.inf]+) dBFS", o)[-1])
    return i, p


def main(src, out, max_s=75.0):
    y, sr = sf.read(src, always_2d=True)
    y = y - y.mean(0)
    m = y.mean(1)
    e, hop = env(m, sr, 0.02)
    nz = np.where(e > e.max() * 10 ** (-40 / 20))[0]
    y = y[nz[0] * hop: (nz[-1] + 1) * hop]
    y = y[: int(max_s * sr) + int(6 * sr)]
    xf = int(XF * sr)
    # onset envelope (half-wave rectified log-energy diff) at 10 ms
    m = y.mean(1)
    e, hop = env(m, sr, 0.01)
    on = np.maximum(np.diff(np.log(e), prepend=np.log(e[0])), 0)
    L = len(y)
    target = min(L - xf, int(max_s * sr))
    head = on[: int(2.0 * sr / hop)]
    head = (head - head.mean()) / (head.std() + 1e-9)
    best, bt = -9, target - xf
    lo = max(target // 2, target - int(3.5 * sr))
    for t in range(lo, target, hop):
        seg = on[t // hop: t // hop + len(head)]
        if len(seg) < len(head):
            break
        seg = (seg - seg.mean()) / (seg.std() + 1e-9)
        c = float((seg * head).mean())
        if c > best:
            best, bt = c, t
    t = bt
    body = y[:t].copy()
    tail = y[t: t + xf]
    a = np.linspace(0, np.pi / 2, xf)[:, None]
    body[:xf] = body[:xf] * np.sin(a) + tail * np.cos(a)
    # loudness: measure, gain, then limit on a circularly padded copy so the seam stays clean
    tmp = tempfile.mkdtemp()
    w1 = os.path.join(tmp, "a.wav"); w2 = os.path.join(tmp, "b.wav")
    sf.write(w1, body.astype(np.float32), sr, subtype="FLOAT")
    i0, _ = lufs(w1)
    g = LUFS - i0
    pad = int(1.0 * sr)
    padded = np.concatenate([body[-pad:], body, body[:pad]]) * 10 ** (g / 20)
    sf.write(w1, padded.astype(np.float32), sr, subtype="FLOAT")
    lim = 10 ** ((PEAK_DB - 1.0) / 20)
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", w1, "-af",
                    f"alimiter=limit={lim:.4f}:attack=5:release=60:level=disabled:asc=1",
                    "-c:a", "pcm_f32le", w2], check=True)
    z, _ = sf.read(w2, always_2d=True)
    z = z[pad: pad + len(body)]
    pk = np.abs(z).max()
    if pk > 10 ** ((PEAK_DB - 0.8) / 20):
        z *= 10 ** ((PEAK_DB - 0.8) / 20) / pk
    sf.write(w1, z.astype(np.float32), sr, subtype="FLOAT")
    for kb in (96, 88, 80, 72, 64):
        subprocess.run([FF, "-y", "-loglevel", "error", "-i", w1, "-ar", "44100", "-c:a", "libvorbis",
                        "-b:a", f"{kb}k", out], check=True)
        if os.path.getsize(out) < 1000 * 1024:
            break
    i1, p1 = lufs(out)
    v, vsr = sf.read(out, always_2d=True)
    mm = v.mean(1)
    rms = 20 * np.log10(np.sqrt((mm ** 2).mean()))
    # seam check: RMS of 50 ms either side of the loop point, and sample jump
    n = int(0.05 * vsr)
    seam = (20 * np.log10(np.sqrt((v[-n:] ** 2).mean())), 20 * np.log10(np.sqrt((v[:n] ** 2).mean())))
    print(f"{os.path.basename(out)}: {len(v)/vsr:.2f}s  {os.path.getsize(out)/1024:.0f} KB @{kb}k  "
          f"I {i1:.1f} LUFS  truepeak {p1:.1f} dBFS  rms {rms:.1f}  ch {v.shape[1]}  "
          f"cut@{t/sr:.2f}s corr {best:.2f}  seam end/start {seam[0]:.1f}/{seam[1]:.1f} dB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 75.0)
