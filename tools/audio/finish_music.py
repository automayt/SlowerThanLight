"""finish_music.py in.flac out.ogg [--start S] [--end E] [--lufs L] [--xf X] [--kbps K] [--mono] [--flatten DB]

Turns a generated music pass into a seamless loop bed for the music director (see finish_title.py for the title shanty):
- keeps the stretch [start, end] (seconds; skip a bad intro or a glitch),
- picks the loop point within the last 4 s of that stretch whose onsets *and* harmony best match the head,
  then crossfades (equal power, X s) the audio after the loop point into the head so the seam is inaudible,
- normalises to L LUFS (default -18, a little under the -16 title shanty, since beds sit under the effects),
  limits peaks on a circularly padded copy so the seam stays clean, and encodes Vorbis (stereo unless --mono).
Prints the checks: length, size, loudness, true peak and the RMS either side of the seam.
"""
import argparse, os, subprocess, tempfile
import numpy as np
import soundfile as sf
import librosa
from finish_title import FF, lufs, env

ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("out")
ap.add_argument("--start", type=float, default=0.0)
ap.add_argument("--end", type=float, default=0.0, help="0 = up to the end, less the crossfade")
ap.add_argument("--lufs", type=float, default=-18.0)
ap.add_argument("--xf", type=float, default=2.0)
ap.add_argument("--kbps", type=int, default=96)
ap.add_argument("--maxkb", type=int, default=1400)
ap.add_argument("--mono", action="store_true")
ap.add_argument("--peak", type=float, default=-1.5)
ap.add_argument("--flatten", type=float, default=0.0, help="even out slow level swells by up to this many dB")
a = ap.parse_args()

y, sr = sf.read(a.src, always_2d=True)
y = y - y.mean(0)
if a.mono:
    y = y.mean(1, keepdims=True)
xf = int(a.xf * sr)
s0 = int(a.start * sr)
e0 = int(a.end * sr) if a.end > 0 else len(y) - xf
e0 = min(e0, len(y) - xf)

# features at ~23 ms hops, on a mono mix
hop = 512
m = librosa.resample(y.mean(1).astype(np.float32), orig_sr=sr, target_sr=22050)
ons = librosa.onset.onset_strength(y=m, sr=22050, hop_length=hop)
chroma = librosa.feature.chroma_cqt(y=m, sr=22050, hop_length=hop)
fr = lambda samples: int(samples / sr * 22050 / hop)
W = fr(int(2.0 * sr))
h0 = fr(s0)


def z(v):
    return (v - v.mean()) / (v.std() + 1e-9)


head_on = z(ons[h0:h0 + W]); head_ch = chroma[:, h0:h0 + W]
best, bt = -9.0, e0
for t in range(max(s0 + int(10 * sr), e0 - int(4 * sr)), e0 + 1, int(0.01 * sr)):
    f = fr(t)
    if f + W > len(ons):
        break
    c_on = float((z(ons[f:f + W]) * head_on).mean())
    c_ch = float(np.mean([np.corrcoef(chroma[:, f + k], head_ch[:, k])[0, 1] for k in range(0, W, 4)]))
    score = c_on + 1.5 * np.nan_to_num(c_ch)
    if score > best:
        best, bt = score, t

body = y[s0:bt].copy()
tail = y[bt:bt + xf]
ang = np.linspace(0, np.pi / 2, xf)[:, None]
body[:xf] = body[:xf] * np.sin(ang) + tail * np.cos(ang)

if a.flatten > 0:
    # Even out slow swells (a pass that builds up would otherwise step down in level at the seam): 1 s block RMS,
    # smoothed over a window that wraps around the loop, turned into a gain of at most +-flatten dB.
    blk = sr
    nb = len(body) // blk
    r = np.sqrt((body[: nb * blk].mean(1).reshape(nb, blk) ** 2).mean(1) + 1e-12)
    k = 4  # 9 s window
    pad_r = np.concatenate([r[-k:], r, r[:k]])
    sm = np.convolve(np.log(pad_r), np.ones(2 * k + 1) / (2 * k + 1), "same")[k:-k]
    gdb = np.clip(20 / np.log(10) * (sm.mean() - sm), -a.flatten, a.flatten)
    centres = (np.arange(nb) + 0.5) * blk
    x = np.arange(len(body))
    g = np.interp(x, np.concatenate([[centres[-1] - nb * blk], centres, [centres[0] + nb * blk]]),
                  np.concatenate([[gdb[-1]], gdb, [gdb[0]]]))
    body = body * (10 ** (g / 20))[:, None]

tmp = tempfile.mkdtemp()
w1 = os.path.join(tmp, "a.wav"); w2 = os.path.join(tmp, "b.wav")
sf.write(w1, body.astype(np.float32), sr, subtype="FLOAT")
i0, _ = lufs(w1)
pad = int(1.0 * sr)
padded = np.concatenate([body[-pad:], body, body[:pad]]) * 10 ** ((a.lufs - i0) / 20)
sf.write(w1, padded.astype(np.float32), sr, subtype="FLOAT")
lim = 10 ** ((a.peak - 1.0) / 20)
subprocess.run([FF, "-y", "-loglevel", "error", "-i", w1, "-af",
                f"alimiter=limit={lim:.4f}:attack=5:release=80:level=disabled:asc=1", "-c:a", "pcm_f32le", w2], check=True)
zz, _ = sf.read(w2, always_2d=True)
zz = zz[pad: pad + len(body)]
pk = np.abs(zz).max()
if pk > 10 ** ((a.peak - 0.5) / 20):
    zz *= 10 ** ((a.peak - 0.5) / 20) / pk
sf.write(w1, zz.astype(np.float32), sr, subtype="FLOAT")
kb = a.kbps
while True:
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", w1, "-ar", "44100", "-c:a", "libvorbis",
                    "-b:a", f"{kb}k", a.out], check=True)
    if os.path.getsize(a.out) <= a.maxkb * 1024 or kb <= 48:
        break
    kb -= 8
i1, p1 = lufs(a.out)
v, vsr = sf.read(a.out, always_2d=True)
n = int(0.05 * vsr)
r = lambda x: 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-12)
jump = float(np.abs(v[0] - v[-1]).max())
print(f"{os.path.basename(a.out)}: {len(v)/vsr:.2f}s  {os.path.getsize(a.out)/1024:.0f} KB @{kb}k  I {i1:.1f} LUFS  "
      f"truepeak {p1:.1f} dBFS  ch {v.shape[1]}  loop {a.start:.1f}-{bt/sr:.2f}s score {best:.2f}  "
      f"seam rms end/start {r(v[-n:]):.1f}/{r(v[:n]):.1f} dB  sample jump {jump:.3f}")
