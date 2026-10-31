"""gen_ui.py: painted sources for the UI kit (parchment, oiled wood, icons). Saves to raw/ui-*.png.

usage: gen_ui.py [name ...]   (no names: every job)
Icons are painted on plain white and cut out by finish_ui.py; textures fill the frame.
"""
import random, sys, time
import gen

TEX_STYLE = (", flat even lighting, seen from directly above, fills the entire frame edge to edge, "
             "painterly oil texture, subtle brush strokes, seamless game texture, no objects, no text")
ICON_STYLE = (", a single object centred, painted game inventory icon, bold clear silhouette, thick dark ink outline, "
              "golden age pirate illustration, warm painterly colours, isolated on a plain pure white background, "
              "no shadow, no frame, no text")

JOBS = [
    # (name, prompt, w, h, style, lora strength)
    ("ui-parchment", "aged parchment paper, warm cream and pale tan, faint tea stains and soft mottling, fine paper fibres, slightly darker toward the edges", 1024, 1024, TEX_STYLE, 0.3),
    ("ui-wood", "dark oiled walnut wood board, rich deep brown, fine long straight grain running horizontally, soft satin sheen, no knots", 1024, 1024, TEX_STYLE, 0.3),
    ("ui-icon-helm", "a wooden ship's steering wheel with eight turned spokes and brass hub, seen face on", 768, 768, ICON_STYLE, 0.35),
    ("ui-icon-sails", "a billowing square canvas sail on a short wooden yard and mast, seen face on", 768, 768, ICON_STYLE, 0.35),
    ("ui-icon-guns", "a black iron naval cannon on a red wooden carriage with small wheels, side view", 768, 768, ICON_STYLE, 0.35),
    ("ui-icon-bulwarks", "a heater shield made of thick oak planks bound with iron bands and rivets, seen face on", 768, 768, ICON_STYLE, 0.35),
    ("ui-icon-pumps", "an old wooden ship's bilge pump with an iron handle, splashing blue water from its spout", 768, 768, ICON_STYLE, 0.35),
    ("ui-icon-surgeon", "a ship surgeon's bone saw crossed with a rolled white linen bandage", 768, 768, ICON_STYLE, 0.35),
    ("ui-icon-gold", "a small heap of shining gold doubloon coins", 768, 768, ICON_STYLE, 0.35),
    ("ui-icon-provisions", "a small oak barrel of salt pork with a loaf of ship's biscuit beside it", 768, 768, ICON_STYLE, 0.35),
    ("ui-icon-crew", "a pirate sailor's black tricorn hat above a red neckerchief, simple emblem", 768, 768, ICON_STYLE, 0.35),
    ("ui-icon-hull", "the wooden hull of a small sailing ship seen from the side, no masts, planks and a row of gunports", 768, 768, ICON_STYLE, 0.35),
    ("ui-icon-round", "one solid black iron cannonball", 768, 768, ICON_STYLE, 0.35),
    ("ui-icon-chain", "chain shot: two black iron cannonballs joined by a short heavy iron chain", 768, 768, ICON_STYLE, 0.35),
    ("ui-icon-grape", "grape shot: a cluster of small iron balls tied in a canvas bag with rope", 768, 768, ICON_STYLE, 0.35),
    ("ui-icon-hot", "a red-hot glowing cannonball wreathed in orange flame", 768, 768, ICON_STYLE, 0.35),
]

only = set(sys.argv[1:])
for name, prompt, w, h, style, lora_s in JOBS:
    if only and name not in only:
        continue
    gen.STYLE = style
    seed = random.randint(1, 2**31)
    t = time.time()
    pid = gen.post(gen.flux_wf(prompt, seed, w, h, lora_s=lora_s))
    out = gen.wait(pid)
    dest = f"{gen.OUT}/{name}.png"
    if out:
        gen.fetch(out, dest)
        print(f"OK {name} seed={seed} {time.time()-t:.0f}s", flush=True)
    else:
        print(f"FAIL {name}", flush=True)
