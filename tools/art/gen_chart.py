"""gen_chart.py: an aged parchment sea chart for the voyage map (no lettering). Saves raw/tex-chart*.png."""
import random, time
import gen

gen.STYLE = (", antique hand-drawn nautical chart, aged yellowed parchment paper with stains and creases, faded sepia ink, "
             "seen flat from directly above, fills the entire frame edge to edge, no lettering")
gen.NEG += ", perspective, table, hands, objects, ships, people, frame, photograph"

PROMPT = ("an empty 18th century sea chart of open ocean on old parchment, faint compass rose in one corner, thin rhumb lines radiating "
          "across the sea, tiny wave marks, a few faint island outlines near the edges, large plain empty sea area in the middle")
for i, seed in enumerate((9101, 9102)):
    t = time.time()
    pid = gen.post(gen.flux_wf(PROMPT, seed, 1344, 768, lora_s=0.2))
    out = gen.wait(pid)
    dest = f"{gen.OUT}/tex-chart{i or ''}.png"
    if out:
        gen.fetch(out, dest)
        print(f"OK {dest} seed={seed} {time.time()-t:.0f}s", flush=True)
    else:
        print("FAIL", seed, flush=True)
