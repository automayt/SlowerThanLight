"""gen_music.py jobs.json [name ...] -> raw/<name>.flac

Long instrumental passes with LTX-2.3 (same graph as gen_sfx.py). Each job: {name, seconds, seed, fps?, prompt}.
The empty audio-latent node caps its frame count at 1000, so the frame count is fed from a PrimitiveInt.
Optional names after the jobs file run only those jobs; jobs whose output already exists are skipped.
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_sfx as g

if __name__ == "__main__":
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    only = set(sys.argv[2:])
    for j in jobs:
        if only and j["name"] not in only:
            continue
        dest = os.path.join(g.OUT, j["name"] + ".flac")
        if os.path.exists(dest):
            print("SKIP", j["name"], flush=True)
            continue
        g.FPS = int(j.get("fps", 24))
        t = time.time()
        w = g.wf(j["prompt"], float(j["seconds"]), int(j.get("seed", 1)), *j.get("wh", [384, 256]))
        w["20"] = {"class_type": "PrimitiveInt", "inputs": {"value": w["8"]["inputs"]["length"]}}
        w["9"]["inputs"]["frames_number"] = ["20", 0]
        out = g.wait(g.post(w), timeout=3600)
        ok = out and g.fetch(out, dest)
        print(("OK " if ok else "FAIL ") + j["name"], f"{time.time()-t:.0f}s", flush=True)
