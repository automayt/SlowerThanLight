"""selfextend.py in.flac out.wav target_s -> lengthen a clip by jumping back once to an earlier, similar-sounding point.

Searches a jump from t1 (late) back to t0 (earlier) so that len = t1 + (L - t0) ~= target, choosing the pair whose
2 s windows match best (onset-envelope correlation + log-spectrum similarity). Equal-power 1 s crossfade.
"""
import sys, numpy as np, soundfile as sf

src, out, target = sys.argv[1], sys.argv[2], float(sys.argv[3])
y, sr = sf.read(src, always_2d=True)
L = len(y)
m = y.mean(1)
hop = int(0.01 * sr)
n = L // hop
e = np.sqrt((m[: n * hop].reshape(n, hop) ** 2).mean(1) + 1e-12)
on = np.maximum(np.diff(np.log(e), prepend=np.log(e[0])), 0)
W = int(2.0 / 0.01)


def spec(t):
    s = np.abs(np.fft.rfft(m[t * hop: t * hop + W * hop] * np.hanning(W * hop)))
    b = np.log(np.add.reduceat(s ** 2, np.geomspace(1, len(s) - 1, 40).astype(int)) + 1e-9)
    return (b - b.mean()) / (b.std() + 1e-9)


def z(x):
    return (x - x.mean()) / (x.std() + 1e-9)


need = target * sr - L  # = t1 - t0 (samples)
best = (-9, 0, 0)
for t1 in range(int(0.6 * n), n - W - int(3 / 0.01), 5):
    t0 = t1 - int(need / hop)
    for d in range(-150, 151, 1):  # +-1.5 s freedom in length
        a = t0 + d
        if a < int(4 / 0.01):
            continue
        c = float((z(on[t1:t1 + W]) * z(on[a:a + W])).mean())
        if c > best[0] - 0.05:
            c2 = c + 0.5 * float((spec(t1) * spec(a)).mean())
            if c2 > best[0]:
                best = (c2, t1, a)
score, t1, t0 = best
xf = int(1.0 * sr)
s1, s0 = t1 * hop, t0 * hop
a = np.linspace(0, np.pi / 2, xf)[:, None]
mid = y[s1:s1 + xf] * np.cos(a) + y[s0:s0 + xf] * np.sin(a)
res = np.concatenate([y[:s1], mid, y[s0 + xf:]])
sf.write(out, res.astype(np.float32), sr, subtype="FLOAT")
print(f"jump {s1/sr:.2f}s -> {s0/sr:.2f}s score {score:.2f}; out {len(res)/sr:.2f}s")
