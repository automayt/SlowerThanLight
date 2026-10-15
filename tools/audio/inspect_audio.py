"""inspect_audio.py file... -> duration, peak, 0.1 s RMS envelope (dBFS), spectral centroid, crest factor"""
import sys
import numpy as np
import soundfile as sf

for p in sys.argv[1:]:
    y, sr = sf.read(p, always_2d=True); m = y.mean(1)
    n = int(sr * 0.1)
    envl = [20 * np.log10(np.sqrt(np.mean(m[i:i + n] ** 2)) + 1e-9) for i in range(0, len(m), n)]
    S = np.abs(np.fft.rfft(m)); f = np.fft.rfftfreq(len(m), 1 / sr)
    lo = S[f < 200].sum() / S.sum()
    pk = np.abs(m).max(); rms = np.sqrt(np.mean(m ** 2))
    print(f"{p.split('/')[-1]:18s} {len(m)/sr:5.2f}s pk {20*np.log10(pk):6.1f} rms {20*np.log10(rms):6.1f} "
          f"crest {20*np.log10(pk/rms):4.1f} centroid {int((S*f).sum()/S.sum()):5d}Hz <200Hz {lo:.2f}")
    print("   ", " ".join(f"{e:.0f}" for e in envl[:60]))
