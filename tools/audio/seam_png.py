"""seam_png.py loop.ogg... --out dir -> spectrogram + waveform of the last 6 s followed by the first 6 s of each loop,
i.e. what the player hears as it wraps around (the seam is the red line). A clean loop shows no gap, click or jump."""
import os, sys
import numpy as np
import soundfile as sf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

args = sys.argv[1:]
out = "."
if "--out" in args:
    i = args.index("--out"); out = args[i + 1]; del args[i:i + 2]
os.makedirs(out, exist_ok=True)
for p in args:
    y, sr = sf.read(p, always_2d=True)
    m = y.mean(1)
    n = int(6 * sr)
    w = np.concatenate([m[-n:], m[:n]])
    fig, ax = plt.subplots(2, 1, figsize=(12, 5), sharex=True)
    t = np.arange(len(w)) / sr - 6
    ax[0].plot(t, w, lw=0.3); ax[0].axvline(0, color="r"); ax[0].set_title(os.path.basename(p) + " around the loop seam")
    ax[1].specgram(w, NFFT=2048, Fs=sr, noverlap=1536, xextent=(-6, 6), cmap="magma", vmin=-140)
    ax[1].axvline(0, color="r", lw=0.6); ax[1].set_ylim(0, 8000)
    fig.tight_layout(); fig.savefig(os.path.join(out, os.path.splitext(os.path.basename(p))[0] + "_seam.png"), dpi=70); plt.close(fig)
