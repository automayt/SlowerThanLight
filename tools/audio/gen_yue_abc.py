"""gen_yue_abc.py name:seed:abcfile ... -> YuE2 music from a given ABC with the Vocal voice forced to rests"""
import sys, os, re, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_yue as Y
g = Y.g

def mute(abc):
    out, cur = [], None
    for l in abc.splitlines():
        if l.startswith("V:"):
            cur = l.split()[1]; out.append(l); continue
        if cur == "Vocal" and not l.startswith("%"):
            parts = re.split(r'("[^"]*")', l)
            parts = [p if p.startswith('"') else re.sub(r"[\^_=]*[A-Ga-g][,']*", "z", p).replace("-", "") for p in parts]
            l = "".join(parts)
        out.append(l)
    return "\n".join(out)

for spec in sys.argv[1:]:
    name, seed, f = spec.split(":", 2)
    abc = mute(open(f, encoding="utf-8").read())
    open(os.path.join(g.OUT, name + ".abc.txt"), "w", encoding="utf-8").write(abc)
    w = Y.wf(int(seed), False, "inst")
    w["10"]["inputs"]["abc"] = abc
    t = time.time()
    out = g.wait(g.post(w), timeout=3600)
    ok = out and g.fetch(out, os.path.join(g.OUT, name + ".flac"))
    print(("OK " if ok else "FAIL ") + name, f"{time.time()-t:.0f}s", flush=True)
