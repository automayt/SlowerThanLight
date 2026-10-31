"""gen_portraits.py jobs_portraits.json [name ...]: head-and-shoulders portraits (Flux + Schoonover LoRA), saved to raw/."""
import json, os, random, sys, time
import gen

gen.STYLE = (", head and shoulders portrait, looking at the viewer, plain dark warm painted background, oil painting, "
             "Caribbean 1715, golden age pirate illustration in the style of Howard Pyle and Frank Schoonover, muted teal "
             "and amber palette, dramatic chiaroscuro side light, painterly brushwork, visible brush strokes, canvas texture")
gen.NEG += ", ship, multiple people, hands covering face, cropped head, sunglasses"

if __name__ == "__main__":
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    only = set(sys.argv[2:])
    for j in jobs:
        if only and j["name"] not in only:
            continue
        dest = os.path.join(gen.OUT, f"{j['name']}.png")
        if os.path.exists(dest) and not only:
            print(f"SKIP {j['name']}", flush=True); continue
        seed = j.get("seed", random.randint(1, 2**31))
        t = time.time()
        pid = gen.post(gen.flux_wf(j["prompt"], seed, j.get("w", 768), j.get("h", 960), lora_s=j.get("lora_s", 0.45)))
        out = gen.wait(pid)
        if out:
            gen.fetch(out, dest)
            print(f"OK {j['name']} seed={seed} {time.time()-t:.0f}s", flush=True)
        else:
            print(f"FAIL {j['name']}", flush=True)
