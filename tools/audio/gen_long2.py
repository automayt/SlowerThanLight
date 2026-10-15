"""Run LTX jobs with a custom fps: args: name seconds seed fps"""
import sys, os, time
sys.path.append(r"E:\ClaudeComfy\SlowerThanLight\tools\audio")
import gen_sfx as g
P = ("Sailors on the deck of an 18th century sailing ship play a lively sea shanty on fiddle, accordion and a small drum "
     "while the ship rolls on the waves. Audio: an upbeat instrumental sea shanty folk tune with fiddle, concertina and stomping rhythm, no singing.")
for spec in sys.argv[1:]:
    name, secs, seed, fps = spec.split(":")
    g.FPS = int(fps)
    t = time.time()
    w = g.wf(P, float(secs), int(seed), *([int(x) for x in os.environ.get("WH","384x256").split("x")]))
    w["20"] = {"class_type": "PrimitiveInt", "inputs": {"value": w["8"]["inputs"]["length"]}}
    w["9"]["inputs"]["frames_number"] = ["20", 0]
    print(name, "frames", w["8"]["inputs"]["length"], flush=True)
    out = g.wait(g.post(w), timeout=3600)
    dest = os.path.join(g.OUT, name + ".flac")
    print(("OK " if out and g.fetch(out, dest) else "FAIL ") + name, f"{time.time()-t:.0f}s", flush=True)
