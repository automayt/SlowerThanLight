"""finish_portraits.py [name ...]: raw/portrait-*.png -> public/art/<name>.jpg (320x400 JPEG), added to manifest.json."""
import glob, json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
DEST = os.path.join(HERE, "..", "..", "public", "art")
MAN = os.path.join(DEST, "manifest.json")


def finalize(name):
    im = Image.open(os.path.join(RAW, name + ".png")).convert("RGB")
    w, h = im.size
    # Head and shoulders: the middle 82% of the width, from just under the top, at 4:5.
    cw = round(w * 0.82); ch = round(cw * 1.25)
    x = (w - cw) // 2; y = min(round(h * 0.02), h - ch)
    im = im.crop((x, y, x + cw, y + ch)).resize((320, 400), Image.LANCZOS)
    out = os.path.join(DEST, name + ".jpg")
    im.save(out, "JPEG", quality=78, optimize=True, progressive=True)
    man = json.load(open(MAN))
    if name + ".jpg" not in man["files"]:
        man["files"].append(name + ".jpg")
    tmp = MAN + ".tmp"
    with open(tmp, "w", newline="\n") as f:
        json.dump(man, f, indent=2)
    os.replace(tmp, MAN)
    return os.path.getsize(out)


if __name__ == "__main__":
    names = sys.argv[1:] or sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(RAW, "portrait-*.png")))
    for n in names:
        print(n, finalize(n), flush=True)
