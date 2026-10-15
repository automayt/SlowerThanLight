# Game art

Painted illustrations in `public/art/` were made with a local ComfyUI (http://127.0.0.1:8188).

- Model: FLUX.1-dev (fp8) with the `flux\schoonover1_cap_d6a3e11` LoRA at 0.45, 28 steps, guidance 3.0, 1344x768.
- `gen.py jobs.json` posts each job (`{name, model: "flux", seed, w, h, kw: {lora_s}, prompt}`) and saves PNGs to `raw/`.
- `finish.py event-foo[=rawstem] ...` trims painted signatures, crops to 768x432 (1280x720 for `title`), saves JPEG
  and adds the file to `public/art/manifest.json`.
- `prompts.json` records every prompt tried per image.

New event art: name it `event-<event id>.jpg`; the event scene picks it up automatically.
