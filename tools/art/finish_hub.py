"""finish_hub.py step ...  -- the harbour hub's art, from raw/ to public/art/.

  cove=<raw>            crop the painted signatures off a 1792x1008 plate, resize to 1680x945 -> hub-cove.jpg
  wall=<raw>            the same for the tavern wall -> hub-wall.jpg
  masks=<raw>           write the inpaint masks (raw/hub-mask-*.png) for the hideout's milestones over that plate
  cut=<raw>:<out>:<h>   trim an RGBA cutout to its figure and scale it to <h> pixels tall -> <out>.png
  overlay=<raw>:<mask>:<out>  what the inpaint painted inside the mask, feathered, cropped and placed on the
                        1680x945 cove -> <out>.png (prints its offset for HarbourScene)

The cove is drawn 1680x945 at (-200, -112) around the 1280x720 design area, so one cove pixel is one screen pixel.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
DEST = os.path.join(HERE, "..", "..", "public", "art")
# Signatures sit in the bottom corners: keep x 36..1756 and y 0..968 of the 1792x1008 plate (16:9 still).
CROP = (36, 0, 1756, 968)
SIZE = (1680, 945)
# Inpaint regions on the raw plate, as (x0, y0, x1, y1).
MASKS = {
    "jetty": (1290, 575, 1650, 735),
    "careen": (1300, 360, 1640, 585),
}


def listed(file):
    """Add a file to public/art/manifest.json (the hideout's art is listed there but loaded by the hideout itself)."""
    man_path = os.path.join(DEST, "manifest.json")
    man = json.load(open(man_path))
    if file not in man["files"]:
        man["files"].append(file)
        tmp = man_path + ".tmp"
        with open(tmp, "w", newline="\n") as f:  # LF on Windows too
            json.dump(man, f, indent=2)
        os.replace(tmp, man_path)


def plate(raw, out):
    im = Image.open(os.path.join(RAW, raw + ".png")).convert("RGB").crop(CROP).resize(SIZE, Image.LANCZOS)
    dest = os.path.join(DEST, out + ".jpg")
    im.save(dest, "JPEG", quality=84, optimize=True, progressive=True)
    listed(out + ".jpg")
    print(out, os.path.getsize(dest))


def masks(raw):
    w, h = Image.open(os.path.join(RAW, raw + ".png")).size
    for name, box in MASKS.items():
        m = Image.new("L", (w, h), 0)
        ImageDraw.Draw(m).rounded_rectangle(box, radius=40, fill=255)
        m = m.filter(ImageFilter.GaussianBlur(10))
        m.convert("RGB").save(os.path.join(RAW, f"hub-mask-{name}.png"))
        print("mask", name, box)


def cut(raw, out, height):
    im = Image.open(os.path.join(RAW, raw + ".png")).convert("RGBA")
    a = im.getchannel("A").point(lambda v: 0 if v < 24 else v)
    im.putalpha(a)
    im = im.crop(a.getbbox())
    w, h = im.size
    im = im.resize((round(w * height / h), height), Image.LANCZOS)
    dest = os.path.join(DEST, out + ".png")
    im.save(dest, optimize=True)
    listed(out + ".png")
    print(out, im.size, os.path.getsize(dest))


def overlay(raw, mask, out):
    im = Image.open(os.path.join(RAW, raw + ".png")).convert("RGB")
    m = Image.open(os.path.join(RAW, f"hub-mask-{mask}.png")).convert("L")
    # Feather inwards so the seam falls where the inpaint matched the plate around it.
    m = m.point(lambda v: max(0, min(255, (v - 40) * 255 // 175))).filter(ImageFilter.GaussianBlur(8))
    rgba = im.copy()
    rgba.putalpha(m)
    rgba = rgba.crop(CROP).resize(SIZE, Image.LANCZOS)
    box = rgba.getchannel("A").point(lambda v: 255 if v > 3 else 0).getbbox()
    rgba = rgba.crop(box)
    dest = os.path.join(DEST, out + ".png")
    rgba.save(dest, optimize=True)
    listed(out + ".png")
    print(out, "at design", box[0] - 200, box[1] - 112, "size", rgba.size, os.path.getsize(dest))


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        step, _, rest = arg.partition("=")
        if step == "cove":
            plate(rest, "hub-cove")
        elif step == "wall":
            plate(rest, "hub-wall")
        elif step == "masks":
            masks(rest)
        elif step == "cut":
            raw, out, h = rest.split(":")
            cut(raw, out, int(h))
        elif step == "overlay":
            raw, mask, out = rest.split(":")
            overlay(raw, mask, out)
