"""pick_sound2.py [name ...] -> picks.json

Scores every take in raw/v2 with CLAP (laion/larger_clap_general): cosine similarity of the audio to the job's caption,
minus a penalty for sounding like singing or speech (we want instrumentals and effects without voices, except the
crowd sounds), plus basic checks (silence, clipping). Long takes are scored on several 10 s windows and averaged.
Writes the best take per file to picks.json and prints a table so a person can overrule it.
"""
import glob, json, os, re, sys
import numpy as np
import soundfile as sf
import librosa
import torch
from transformers import ClapModel, ClapProcessor

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw", "v2")
PICKS = os.path.join(HERE, "picks.json")
VOICE = ["a person singing", "a man talking", "a choir singing words"]
VOICED_OK = {"boarders", "cheer", "amb-tavern", "amb-harbour"}

dev = "cuda" if torch.cuda.is_available() else "cpu"
model = ClapModel.from_pretrained("laion/larger_clap_general").to(dev).eval()
proc = ClapProcessor.from_pretrained("laion/larger_clap_general")


def text_emb(texts):
    t = proc(text=texts, return_tensors="pt", padding=True).to(dev)
    with torch.no_grad():
        e = model.get_text_features(**t)
    return torch.nn.functional.normalize(e, dim=-1)


def audio_emb(y):
    a = proc(audios=y, sampling_rate=48000, return_tensors="pt").to(dev)
    with torch.no_grad():
        e = model.get_audio_features(**a)
    return torch.nn.functional.normalize(e, dim=-1)


def windows(y, sr=48000, w=10.0, n=5):
    L = int(w * sr)
    if len(y) <= L:
        return [y]
    starts = np.linspace(0, len(y) - L, n).astype(int)
    return [y[s:s + L] for s in starts]


CAPTIONS = {j["name"]: j["caption"] for jobs in json.load(open(os.path.join(HERE, "jobs_sound2.json"), encoding="utf-8")).values()
            if isinstance(jobs, list) for j in jobs}
MODERN = ["electronic dance music", "rock music with electric guitar", "hip hop beat", "jazz", "pop song with singing"]


def score(path, caption, base, kind="sfx"):
    y, sr = sf.read(path, always_2d=True)
    mono = y.mean(1).astype(np.float32)
    peak = float(np.abs(y).max())
    clip = float(np.mean(np.abs(y) > 0.995))
    m48 = librosa.resample(mono, orig_sr=sr, target_sr=48000)
    e = librosa.feature.rms(y=mono, frame_length=2048, hop_length=1024)[0]
    silent = float(np.mean(e < e.max() * 0.01)) if e.max() > 0 else 1.0
    a = torch.cat([audio_emb(w) for w in windows(m48)])
    t = text_emb([caption] + VOICE + MODERN)
    sims = (a @ t.T).mean(0).cpu().numpy()
    voice = float(sims[1:1 + len(VOICE)].max())
    modern = float(sims[1 + len(VOICE):].max())
    s = float(sims[0]) - (0 if base in VOICED_OK else 0.5 * max(0.0, voice - 0.1))
    # Period music: anything that sounds like a modern genre is marked down.
    if kind in ("music", "sting"):
        s -= 0.6 * max(0.0, modern - 0.17)
    if peak < 0.05:
        s -= 1
    s -= 0.5 * max(0.0, silent - 0.3)
    return dict(score=round(s, 4), match=round(float(sims[0]), 4), voice=round(voice, 4), modern=round(modern, 4),
                silent=round(silent, 3), clip=round(clip, 5), dur=round(len(mono) / sr, 2))


if __name__ == "__main__":
    want = set(sys.argv[1:])
    picks = json.load(open(PICKS)) if os.path.exists(PICKS) else {}
    groups = {}
    for f in sorted(glob.glob(os.path.join(RAW, "*_t*.flac"))):
        fname = re.sub(r"_t\d+\.flac$", "", os.path.basename(f))
        groups.setdefault(fname, []).append(f)
    for fname, takes in groups.items():
        meta = json.load(open(takes[0] + ".json"))
        base = meta["name"]
        meta["caption"] = CAPTIONS.get(base, meta["caption"])  # the job file's current caption wins
        if want and fname not in want and base not in want:
            continue
        rows = [(os.path.basename(t), score(t, meta["caption"], base, meta["kind"])) for t in takes]
        rows.sort(key=lambda r: -r[1]["score"])
        picks[fname] = rows[0][0]
        print(fname, "->", rows[0][0])
        for name, r in rows:
            print("   ", name, r)
    json.dump(picks, open(PICKS, "w"), indent=1)
