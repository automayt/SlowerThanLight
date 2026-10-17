# Game audio

Sound effects in `public/audio/` were made with the local ComfyUI using LTX-2.3 22B (fp8, distilled LoRA 0.5),
an audio+video model: a tiny video is rendered alongside each sound and only the audio is kept.

- `gen_sfx.py jobs.json` generates candidates through ComfyUI into `raw/` (gitignored).
- `finish_sfx.py` trims, loudness-normalises, crossfades loops, encodes mono Vorbis `.ogg` and updates `public/audio/manifest.json`.
- `inspect_audio.py` prints duration, peak and RMS checks (renamed from inspect.py, which shadowed the standard library).
- `jobs.json` / `jobs2.json` hold the prompts.

The game picks variants by prefix: `cannon-1.ogg`, `cannon-2.ogg`... all play for "cannon".

## Title music

`public/audio/shanty.ogg` is a 55.5 s instrumental loop: LTX-2.3 with the original shanty prompt, seed 702, one 60 s pass
(the empty audio-latent node caps at 1000 frames; feed the frame count, 1441 at 24 fps, from a separate `PrimitiveInt`).
`finish_title.py` loops it on the beat, normalises to -16 LUFS and encodes stereo Vorbis 96 kbps.
`gen_long2.py`, `selfextend.py`, `gen_yue.py` and `gen_yue_abc.py` made the other candidates; they were written in a
scratch folder, so check their paths before re-running. Candidates (including the original 20 s loop) live in the
gitignored `candidates/` folder.

## Second batch (jobs3.json)

`click`, `coins`, `breach`, `explosion`, `boarders` and the `creak` loop came from `jobs3.json` with the same recipe
(one take each; seeds in the file). Each was checked by duration, loudness and spectral centroid rather than by ear,
so listen through and regenerate any that miss: `python gen_sfx.py jobs3.json`, then
`python finish_sfx.py click=click_a coins=coins_a ...`.
