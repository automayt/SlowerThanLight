# Game art

Painted illustrations in `public/art/` were made with a local ComfyUI (http://127.0.0.1:8188).

- Model: FLUX.1-dev (fp8) with the `flux\schoonover1_cap_d6a3e11` LoRA at 0.45, 28 steps, guidance 3.0, 1344x768.
- `gen.py jobs.json` posts each job (`{name, model: "flux", seed, w, h, kw: {lora_s}, prompt}`) and saves PNGs to `raw/`.
- `finish.py event-foo[=rawstem] ...` trims painted signatures, crops to 768x432 (1280x720 for `title`), saves JPEG
  and adds the file to `public/art/manifest.json`.
- `prompts.json` records every prompt tried per image.

New event art: name it `event-<event id>.jpg`; the event scene picks it up automatically.

## UI kit

`public/ui/` holds the painted pieces of the UI kit, loaded by `preloadKit` (src/render/ui.ts):

- `gen_ui.py [name ...]` renders the sources to `raw/ui-*.png`: a parchment sheet and an oiled-walnut board (FLUX + LoRA 0.3,
  1024x1024) and the icons (LoRA 0.35, 768x768, one object on plain white).
- `finish_ui.py [wood] [parchment] [icons]` makes `wood.jpg` (a seamless two-plank tile), `parchment.png` (browned, with a
  deckled alpha edge, for 9-slicing) and `icons.png`/`icons.json` (a 64px Phaser atlas: each icon cut from its white
  ground, with a dark keyline so it reads on wood and on parchment). Icons painted standing on a tan floor are listed in
  `TAN_GROUND` so the floor is cut away too.
- Button plaques, the brass frame, the ribbon and the small drawn icons (fire, wind, hammer…) are painted in code
  (ui.ts, icons.ts), sampling the walnut where it has loaded.
