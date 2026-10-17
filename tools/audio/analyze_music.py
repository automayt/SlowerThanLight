"""analyze_music.py file... [--png outdir] -> listening-free checks for generated music.

Prints duration, loudness envelope spread, tempo and beat regularity, spectral flatness (noise-like audio scores high),
harmonic share (HPSS), chroma clarity (how strongly a few pitch classes dominate: tonal music scores high, mush scores
low) and key stability (each 5 s chroma profile against the whole: a track that wanders or breaks down scores low).
With --png, writes a mel spectrogram + waveform + chroma image per file for a visual check.
"""
import os, sys
import numpy as np
import scipy.signal
if not hasattr(scipy.signal, 'hann'):  # older librosa with newer scipy
    import scipy.signal.windows
    scipy.signal.hann = scipy.signal.windows.hann
import librosa
import librosa.display

args = sys.argv[1:]
png = None
if "--png" in args:
    i = args.index("--png"); png = args[i + 1]; del args[i:i + 2]
    os.makedirs(png, exist_ok=True)

for p in args:
    y, sr = librosa.load(p, sr=22050, mono=True)
    dur = len(y) / sr
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    rdb = 20 * np.log10(rms + 1e-9)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    bt = librosa.frames_to_time(beats, sr=sr)
    ibi = np.diff(bt)
    beat_cv = float(ibi.std() / ibi.mean()) if len(ibi) > 2 else 9.0
    flat = float(np.median(librosa.feature.spectral_flatness(y=y)))
    H, P = librosa.effects.hpss(y)
    harm = float((H ** 2).sum() / ((H ** 2).sum() + (P ** 2).sum()))
    chroma = librosa.feature.chroma_cqt(y=H, sr=sr)
    prof = chroma.mean(1)
    clarity = float(np.sort(prof)[-3:].sum() / prof.sum())  # top-3 pitch classes' share (1/4 = flat)
    # stability: correlation of each 5 s chroma profile with the whole-track profile
    seg = int(5 * sr / 512)
    cors = [np.corrcoef(chroma[:, i:i + seg].mean(1), prof)[0, 1] for i in range(0, chroma.shape[1] - seg, seg)]
    print(f"{os.path.basename(p):24s} {dur:5.1f}s  rms {np.median(rdb):5.1f}dB  spread(p10-p90) {np.percentile(rdb,90)-np.percentile(rdb,10):4.1f}dB  "
          f"tempo {float(np.atleast_1d(tempo)[0]):5.1f}  beatCV {beat_cv:.2f}  flat {flat:.3f}  harm {harm:.2f}  "
          f"chroma-top3 {clarity:.2f}  key-stability min {min(cors):.2f} mean {np.mean(cors):.2f}")
    if png:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(3, 1, figsize=(14, 7), sharex=True, gridspec_kw={"height_ratios": [1, 3, 1.4]})
        t = np.arange(len(y)) / sr
        ax[0].plot(t[::50], y[::50], lw=0.4); ax[0].set_ylim(-1, 1); ax[0].set_title(os.path.basename(p))
        for b in bt: ax[0].axvline(b, color="r", lw=0.2)
        S = librosa.power_to_db(librosa.feature.melspectrogram(y=y, sr=sr, n_mels=128), ref=np.max)
        librosa.display.specshow(S, sr=sr, x_axis="time", y_axis="mel", ax=ax[1]) if hasattr(librosa, "display") else ax[1].imshow(S, aspect="auto", origin="lower")
        librosa.display.specshow(chroma, sr=sr, x_axis="time", y_axis="chroma", ax=ax[2])
        fig.tight_layout()
        fig.savefig(os.path.join(png, os.path.splitext(os.path.basename(p))[0] + ".png"), dpi=70)
        plt.close(fig)
