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

## Third batch (jobs4.json, synth_sfx.py)

From LTX-2.3 (`jobs4.json`): `fanfare` (fanfare_b), `defeat` (defeat_a), `cheer` (cheer_b), `sink` (groan_b, a low
groaning rumble and gurgle) and a re-cut `splash` (splash_d, now starting on the impact instead of half a second early).
LTX renders sharp, sparse sounds as a steady wash, so every musket, sail, quill, page and seal take came out as noise;
`synth_sfx.py` builds `musket`, `sail`, `quill` and `page` from filtered noise instead (seeded, so re-runs match).
Finish both kinds with `finish_sfx.py name=stem`. Not yet heard by a person: listen through.

## Music beds

The music director in `src/render/sound.ts` plays one bed per screen: `shanty` (title, ship select, logbook),
`music-sea` (chart, events, results, run end), `music-port` and `music-battle`. They are listed under `"music"` in
`public/audio/manifest.json`, so they stream in after the first screen instead of on the loading bar.

- `gen_music.py jobs_music.json` renders 60 s LTX-2.3 passes (about 4-7 minutes each on a shared GPU).
- `analyze_music.py raw/x.flac --png dir` reports tempo, beat regularity, tonality and key stability and draws a
  spectrogram, waveform and chromagram, which is how the takes were chosen without listening.
- `finish_music.py raw/x.flac ../../public/audio/music-x.ogg --start S --end E` keeps a clean stretch, loops it at the
  point whose onsets and harmony best match the head, normalises to -18 LUFS and encodes stereo Vorbis 96k.
- `seam_png.py loop.ogg --out dir` draws the wrap-around so a click or jump would show.

## Second pass: dedicated audio models (jobs_sound2.json)

Everything the adaptive mixer plays (music beds, stings, ambience layers, effects) was regenerated with models made for
audio instead of LTX's video soundtrack. The models live on `F:/ComfyModels` (listed in `E:/ComfyUI/extra_model_paths.yaml`).

- **Music and stings:** ACE-Step 1.5 XL turbo, 8 steps, `[Instrumental]` lyrics; tags, BPM, key and metre per track
  in `jobs_sound2.json`. A 150 s bed takes about 33 s on the 3090.
- **Ambience and effects:** Stable Audio 3 medium, 8-step lcm, prompted directly (the template's Qwen re-prompt is skipped).

Steps:
1. `python gen_sound2.py jobs_sound2.json [music sting amb sfx] [--only a,b] [--takes N]` renders takes into `raw/v2/`.
   Each take's seed and job are stored next to it as `<take>.flac.json`.
2. `python pick_sound2.py [names]` scores every take with CLAP (`laion/larger_clap_general`) and writes the best to
   `picks.json`. The score is the match to the job's caption, minus penalties for:
   - voices (except crowd sounds);
   - modern genres (music only);
   - silence and clipping.
   The printed table lets a person overrule a pick by editing `picks.json`.
3. `python finish_sound2.py [names]` finishes the picks into `out_v2/`:
   - music loops through `finish_music.py`;
   - stings start on the first onset and fade out;
   - ambience gets a 2 s equal-power loop crossfade;
   - effects get `finish_sfx.process`.
   Copy the results into `public/audio/` and list them in the manifest (`files`, `music`, `ambience`).

None of this was checked by ear. Listen through the picks and regenerate any that miss.
