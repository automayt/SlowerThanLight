"""finish_textures.py: crop/rotate the raw/tex-*.png renders into public/art/ and list them in manifest.json."""
import json, os
from PIL import Image, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
DEST = os.path.join(HERE, "..", "..", "public", "art")
MAN = os.path.join(DEST, "manifest.json")

def deck(im):
    # Planks come out vertical with a stray fitting top-left: crop it away, then turn the planks to run fore and aft.
    w, h = im.size
    im = im.crop((420, 0, w, h)).rotate(90, expand=True)
    return im.resize((im.width * 2 // 3, im.height * 2 // 3), Image.LANCZOS)

def hull(im):
    return im.resize((896, 512), Image.LANCZOS)

def sea(im):
    im = ImageEnhance.Brightness(im).enhance(0.8)
    return im.resize((1280, 731), Image.LANCZOS).crop((0, 5, 1280, 725))

def canvas(im):
    return im.resize((672, 384), Image.LANCZOS)

JOBS = {"tex-deck": deck, "tex-hull": hull, "tex-sea": sea, "tex-canvas": canvas}

man = json.load(open(MAN))
for name, fn in JOBS.items():
    src = os.path.join(RAW, name + ".png")
    if not os.path.exists(src):
        print("skip", name); continue
    out = os.path.join(DEST, name + ".jpg")
    fn(Image.open(src).convert("RGB")).save(out, "JPEG", quality=84, optimize=True, progressive=True)
    if name + ".jpg" not in man["files"]:
        man["files"].append(name + ".jpg")
    print(name, os.path.getsize(out))
json.dump(man, open(MAN + ".tmp", "w"), indent=2)
os.replace(MAN + ".tmp", MAN)
