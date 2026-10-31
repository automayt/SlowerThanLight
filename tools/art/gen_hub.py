"""gen_hub.py jobs.json [name ...] -- the harbour hub's art.

Job kinds (field "kind"):
  plate   - a full painting (FLUX + Schoonover LoRA), saved to raw/<name>.png
  cutout  - a painting on a plain ground, then RMBG-2.0 background removal: raw/<name>.png is RGBA
  inpaint - repaint the white part of mask raw/<mask>.png over raw/<base>.png (FLUX dev + differential diffusion)
"""
import json, os, random, sys, time, urllib.request
from gen import URL, OUT, flux_wf, post, wait, fetch


def upload(path, name):
    boundary = "----stlhub" + str(random.randint(0, 1 << 30))
    data = open(path, "rb").read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + data + \
           (f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request(URL + "/upload/image", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return json.load(urllib.request.urlopen(req))["name"]


def cutout_wf(prompt, seed, w, h, lora_s=0.45):
    wf = flux_wf(prompt, seed, w, h, lora_s=lora_s)
    wf["20"] = {"class_type": "RMBG", "inputs": {"image": ["9", 0], "model": "RMBG-2.0", "sensitivity": 1.0, "process_res": 1024,
                "mask_blur": 0, "mask_offset": 0, "invert_output": False, "refine_foreground": True, "unload_model": False,
                "background": "Alpha", "background_color": "#222222"}}
    wf["10"]["inputs"]["images"] = ["20", 0]
    wf["10"]["inputs"]["filename_prefix"] = "stl_art/hubcut"
    return wf


def inpaint_wf(prompt, seed, base_name, mask_name, lora_s=0.45, denoise=1.0, steps=28):
    wf = flux_wf(prompt, seed, 64, 64, lora_s=lora_s, steps=steps)
    wf["30"] = {"class_type": "LoadImage", "inputs": {"image": base_name}}
    wf["31"] = {"class_type": "LoadImageMask", "inputs": {"image": mask_name, "channel": "red"}}
    wf["32"] = {"class_type": "DifferentialDiffusion", "inputs": {"model": ["11", 0]}}
    wf["33"] = {"class_type": "InpaintModelConditioning", "inputs": {"positive": ["12", 0], "negative": ["6", 0], "vae": ["3", 0],
                "pixels": ["30", 0], "mask": ["31", 0], "noise_mask": True}}
    wf["8"]["inputs"].update(model=["32", 0], positive=["33", 0], negative=["33", 1], latent_image=["33", 2], denoise=denoise)
    del wf["7"]
    wf["10"]["inputs"]["filename_prefix"] = "stl_art/hubinp"
    return wf


if __name__ == "__main__":
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    only = set(sys.argv[2:])
    for j in jobs:
        if only and j["name"] not in only:
            continue
        seed = j.get("seed", random.randint(1, 2**31))
        kind = j.get("kind", "plate")
        kw = j.get("kw", {})
        if kind == "cutout":
            wf = cutout_wf(j["prompt"], seed, j["w"], j["h"], **kw)
        elif kind == "inpaint":
            # Crop and stitch: the region (plus context) is cut out and enlarged, so the model paints it at full size.
            from PIL import Image
            box = j["crop"]
            cw, ch = box[2] - box[0], box[3] - box[1]
            size = (1024, round(1024 * ch / cw / 16) * 16)
            for src, tag in ((j["base"], "base"), (j["mask"], "mask")):
                Image.open(os.path.join(OUT, src + ".png")).convert("RGB").crop(box).resize(size, Image.LANCZOS).save(os.path.join(OUT, f"_crop_{tag}.png"))
            b = upload(os.path.join(OUT, "_crop_base.png"), f"stlhub_{j['name']}_base.png")
            m = upload(os.path.join(OUT, "_crop_mask.png"), f"stlhub_{j['name']}_mask.png")
            wf = inpaint_wf(j["prompt"], seed, b, m, **kw)
        else:
            wf = flux_wf(j["prompt"], seed, j["w"], j["h"], **kw)
        t = time.time()
        pid = post(wf)
        out = wait(pid)
        dest = os.path.join(OUT, f"{j['name']}.png")
        if out:
            fetch(out, dest)
            if kind == "inpaint":
                from PIL import Image
                plate = Image.open(os.path.join(OUT, j["base"] + ".png")).convert("RGB")
                plate.paste(Image.open(dest).convert("RGB").resize((cw, ch), Image.LANCZOS), box[:2])
                plate.save(dest)
            print(f"OK {j['name']} seed={seed} {time.time()-t:.0f}s -> {dest}", flush=True)
        else:
            print(f"FAIL {j['name']}", flush=True)
