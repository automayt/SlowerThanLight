"""finish.py name[=rawstem] ...  -> writes public/art/<name>.jpg and adds it to manifest.json"""
import json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
DEST = os.path.join(HERE, "..", "..", "public", "art")
MAN = os.path.join(DEST, "manifest.json")
MODEL = ("FLUX.1-dev (fp8_e4m3fn weights) + Schoonover golden-age illustration LoRA @0.45, "
         "ComfyUI txt2img, 28 steps euler/simple, guidance 3.0, 1344x768")


def finalize(name, stem=None):
    os.makedirs(DEST, exist_ok=True)
    im = Image.open(os.path.join(RAW, (stem or name) + ".png")).convert("RGB")
    tw, th = (1280, 720) if name == "title" else (768, 432)
    w, h = im.size
    # trim ~4% (bottom-weighted) to drop painted signatures in the corners
    mx, mt, mb = round(w * 0.02), round(h * 0.013), round(h * 0.042)
    im = im.crop((mx, mt, w - mx, h - mb)); w, h = im.size
    if w / h > tw / th:
        nw = round(h * tw / th); x = (w - nw) // 2; im = im.crop((x, 0, x + nw, h))
    else:
        nh = round(w * th / tw); y = (h - nh) // 2; im = im.crop((0, y, w, y + nh))
    im = im.resize((tw, th), Image.LANCZOS)
    out = os.path.join(DEST, name + ".jpg")
    q = 82 if not name.startswith("event-") else 80
    while True:
        im.save(out, "JPEG", quality=q, optimize=True, progressive=True)
        if not name.startswith("event-") or os.path.getsize(out) <= 120_000 or q <= 60:
            break
        q -= 5
    man = json.load(open(MAN)) if os.path.exists(MAN) else {"model": MODEL, "files": []}
    man["model"] = MODEL
    if name + ".jpg" not in man["files"]:
        man["files"].append(name + ".jpg")
    tmp = MAN + ".tmp"
    json.dump(man, open(tmp, "w"), indent=2)
    os.replace(tmp, MAN)
    return os.path.getsize(out), q


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        name, _, stem = arg.partition("=")
        print(name, *finalize(name, stem or None), flush=True)
