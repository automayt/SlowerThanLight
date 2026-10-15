# Game audio

Sound effects in `public/audio/` were made with the local ComfyUI using LTX-2.3 22B (fp8, distilled LoRA 0.5),
an audio+video model: a tiny video is rendered alongside each sound and only the audio is kept.

- `gen_sfx.py jobs.json` generates candidates through ComfyUI into `raw/` (gitignored).
- `finish_sfx.py` trims, loudness-normalises, crossfades loops, encodes mono Vorbis `.ogg` and updates `public/audio/manifest.json`.
- `inspect.py` prints duration, peak and RMS checks.
- `jobs.json` / `jobs2.json` hold the prompts.

The game picks variants by prefix: `cannon-1.ogg`, `cannon-2.ogg`... all play for "cannon".
