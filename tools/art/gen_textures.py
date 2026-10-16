"""gen_textures.py: painted surface textures for the battle view (deck, hull, sea, canvas). Saves to raw/tex-*.png."""
import random, sys, time
import gen

gen.STYLE = (", flat even lighting, seen from directly above, top-down orthographic view, fills the entire frame edge to edge, "
             "painterly oil texture, subtle brush strokes, game texture, no objects, no people, no ships, no horizon")
gen.NEG += ", perspective, horizon, sky, vignette, shadows, objects, ships, people, rope, cannon"

JOBS = [
    ("tex-deck", "weathered honey-brown oak ship deck planks running horizontally, long straight parallel planks with thin dark tar caulking seams between them, worn grain, scattered treenail pegs"),
    ("tex-hull", "dark tarred ship hull planking, near-black brown wood strakes running horizontally, slight sheen of pitch, worn and weathered"),
    ("tex-sea", "deep teal-green open ocean water surface, gentle swell, small white foam streaks and ripples, rich painterly blues and greens"),
    ("tex-canvas", "weathered off-white cream sailcloth canvas, vertical stitched seams, soft folds, slightly stained"),
]

only = set(sys.argv[1:])
for name, prompt in JOBS:
    if only and name not in only:
        continue
    for i, lora_s in enumerate((0.3,)):
        seed = random.randint(1, 2**31)
        t = time.time()
        pid = gen.post(gen.flux_wf(prompt, seed, 1344, 768, lora_s=lora_s))
        out = gen.wait(pid)
        dest = f"{gen.OUT}/{name}.png"
        if out:
            gen.fetch(out, dest)
            print(f"OK {name} seed={seed} {time.time()-t:.0f}s", flush=True)
        else:
            print(f"FAIL {name}", flush=True)
