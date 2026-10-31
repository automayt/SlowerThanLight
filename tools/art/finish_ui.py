"""finish_ui.py: turn the raw/ui-*.png renders from gen_ui.py into the UI kit under public/ui/.

- ui/wood.jpg       a seamless oiled-walnut tile (two planks tall), for panel and button faces
- ui/parchment.png  a parchment sheet with a browned, deckled edge, for 9-slice panels, tooltips and toasts
- ui/icons.png/json a Phaser atlas of the painted icons, cut from their white ground, with a dark keyline

usage: finish_ui.py [wood] [parchment] [icons]   (no names: all three)
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
DEST = os.path.join(HERE, "..", "..", "public", "ui")
os.makedirs(DEST, exist_ok=True)

ICONS = ["helm", "sails", "guns", "bulwarks", "pumps", "surgeon", "round", "chain", "grape", "hot",
         "gold", "provisions", "crew", "hull"]
ICON = 64  # atlas cell, px
# Icons painted standing on a patch of tan floor, which goes with the white (the others keep their pale parts).
TAN_GROUND = {"guns", "bulwarks"}


def wood():
    im = Image.open(os.path.join(RAW, "ui-wood.png")).convert("RGB")
    # Exactly two planks, seam to seam, so the tile repeats down a panel on the plank lines.
    a = np.asarray(im.crop((70, 243, 954, 760)), dtype=np.float32)
    # Wrap left and right: cross-fade the last band into the first.
    band = 96
    t = np.linspace(0, 1, band)[None, :, None]
    a[:, :band] = a[:, :band] * t + a[:, -band:] * (1 - t)
    a = a[:, : a.shape[1] - band]
    out = Image.fromarray(a.clip(0, 255).astype(np.uint8)).resize((640, 413), Image.LANCZOS)
    out.save(os.path.join(DEST, "wood.jpg"), "JPEG", quality=84, optimize=True, progressive=True)
    print("wood", out.size, os.path.getsize(os.path.join(DEST, "wood.jpg")))


def parchment():
    im = Image.open(os.path.join(RAW, "ui-parchment.png")).convert("RGB")
    S = 320
    a = np.asarray(im.crop((120, 120, 904, 904)).resize((S, S), Image.LANCZOS), dtype=np.float32)
    rng = np.random.default_rng(3)
    # Distance in from the nearest edge, roughened so the browning and the deckle wander.
    def wobble(n, amp, smooth):
        return ndimage.gaussian_filter1d(rng.normal(0, 1, n), smooth) * amp
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    def edge_distance(amp_coarse, amp_fine):
        w = lambda: wobble(S, amp_coarse, 6) + wobble(S, amp_fine, 2.5)
        return np.minimum.reduce([xx + w()[:, None], (S - 1 - xx) + w()[:, None], yy + w()[None, :], (S - 1 - yy) + w()[None, :]])
    # The deckle is rough; the browning follows a smoother line.
    d = edge_distance(2.5, 1.2)
    soft = edge_distance(6, 0)
    # Browning toward the edge, as old paper goes, plus a faint mottle.
    brown = np.array([120, 78, 36], dtype=np.float32)
    k = np.clip(1 - soft / 34, 0, 1) ** 1.8 * 0.75
    mottle = ndimage.gaussian_filter(rng.normal(0, 1, (S, S)), 10) * 30
    k = np.clip(k + np.clip(mottle, 0, None) * 0.004, 0, 0.85)
    rgb = a * (1 - k[..., None]) + brown * k[..., None]
    # A slightly darker, burnt rim right at the deckle.
    rim = np.clip(1 - (d - 3) / 3, 0, 1)[..., None] * 0.45
    rgb = rgb * (1 - rim) + np.array([70, 40, 16]) * rim
    alpha = np.clip((d - 2.0) * 1.2, 0, 1) * 255
    out = Image.fromarray(np.dstack([rgb.clip(0, 255), alpha]).astype(np.uint8), "RGBA")
    out.save(os.path.join(DEST, "parchment.png"), optimize=True)
    print("parchment", out.size, os.path.getsize(os.path.join(DEST, "parchment.png")))


def cut_icon(name):
    src = os.path.join(RAW, f"ui-icon-{name}.png")
    if not os.path.exists(src):
        return None
    im = Image.open(src).convert("RGB")
    a = np.asarray(im, dtype=np.float32)
    # The ground: pale and unsaturated, joined to the border (white inside the object stays).
    pale = (a.min(axis=2) > 222) & ((a.max(axis=2) - a.min(axis=2)) < 26)
    lab, _ = ndimage.label(pale)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    ground = np.isin(lab, list(border))
    # The painted floor under an object (light tan smudges) goes too: light, dull pixels joined to that ground.
    loose = (((a.min(axis=2) > 110) & (a.max(axis=2) > 190)) if name in TAN_GROUND else ((a.min(axis=2) > 165) & ((a.max(axis=2) - a.min(axis=2)) < 75))) | ground
    lab, _ = ndimage.label(loose)
    ground = np.isin(lab, list(set(np.unique(lab[ground])) - {0}))
    # Drop specks: keep the largest object and anything big near it.
    obj = ~ground
    lab2, n = ndimage.label(obj)
    if n > 1:
        sizes = ndimage.sum(obj, lab2, range(1, n + 1))
        keep = [i + 1 for i, s in enumerate(sizes) if s >= max(sizes) * 0.04]
        obj = np.isin(lab2, keep)
    obj = ndimage.binary_closing(obj, iterations=2)
    alpha = ndimage.gaussian_filter(obj.astype(np.float32), 1.2)
    ys, xs = np.where(obj)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    rgba = np.dstack([a, alpha * 255]).astype(np.uint8)
    crop = Image.fromarray(rgba, "RGBA").crop((x0, y0, x1 + 1, y1 + 1))
    # Square, with a margin for the keyline.
    side = max(crop.size)
    inner = ICON - 6
    sc = inner / side
    crop = crop.resize((max(1, round(crop.width * sc)), max(1, round(crop.height * sc))), Image.LANCZOS)
    cell = Image.new("RGBA", (ICON, ICON), (0, 0, 0, 0))
    cell.alpha_composite(crop, ((ICON - crop.width) // 2, (ICON - crop.height) // 2))
    # A dark keyline round the silhouette, so it reads on wood and on parchment alike.
    al = np.asarray(cell)[..., 3].astype(np.float32) / 255
    halo = np.clip(ndimage.maximum_filter(al, size=3) * 1.0, 0, 1)
    halo = ndimage.gaussian_filter(halo, 0.6)
    under = Image.fromarray(np.dstack([np.full((ICON, ICON, 3), (24, 12, 4)), halo * 230]).astype(np.uint8), "RGBA")
    under.alpha_composite(cell)
    return under


def icons():
    cols = 4
    names = [n for n in ICONS if os.path.exists(os.path.join(RAW, f"ui-icon-{n}.png"))]
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * ICON, rows * ICON), (0, 0, 0, 0))
    frames = {}
    for i, n in enumerate(names):
        cell = cut_icon(n)
        x, y = (i % cols) * ICON, (i // cols) * ICON
        sheet.alpha_composite(cell, (x, y))
        frames[n] = {"frame": {"x": x, "y": y, "w": ICON, "h": ICON}, "rotated": False, "trimmed": False,
                     "spriteSourceSize": {"x": 0, "y": 0, "w": ICON, "h": ICON}, "sourceSize": {"w": ICON, "h": ICON}}
    sheet.save(os.path.join(DEST, "icons.png"), optimize=True)
    meta = {"image": "icons.png", "size": {"w": sheet.width, "h": sheet.height}, "scale": "1"}
    with open(os.path.join(DEST, "icons.json"), "w", newline="\n") as f:
        json.dump({"frames": frames, "meta": meta}, f, indent=1)
    print("icons", names, os.path.getsize(os.path.join(DEST, "icons.png")))


steps = {"wood": wood, "parchment": parchment, "icons": icons}
for name in sys.argv[1:] or list(steps):
    steps[name]()
