import json, sys, time, urllib.request, urllib.parse, os, random

URL = "http://127.0.0.1:8188"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")  # gitignored
os.makedirs(OUT, exist_ok=True)

STYLE = (", oil painting, age of sail, Caribbean 1715, muted teal and amber palette, dramatic light, "
         "painterly brushwork, visible brush strokes, canvas texture, Howard Pyle golden age illustration, "
         "historically accurate early 18th century sailing ships")
NEG = ("text, letters, words, caption, signature, watermark, logo, typography, writing, numbers, "
       "modern objects, motorboat, engine, photograph, photorealistic, 3d render, cgi, anime, cartoon, "
       "blurry, lowres, deformed, extra limbs, bad anatomy, mangled rigging, distorted ship, frame, border")


def qwen_wf(prompt, seed, w, h, steps=26, cfg=2.8, lightning=False):
    wf = {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": "qwen-image-Q8_0.gguf"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors", "type": "qwen_image", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "4": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": 3.1}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": prompt + STYLE}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": NEG}},
        "7": {"class_type": "EmptySD3LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "8": {"class_type": "KSampler", "inputs": {"model": ["4", 0], "positive": ["5", 0], "negative": ["6", 0],
              "latent_image": ["7", 0], "seed": seed, "steps": steps, "cfg": cfg,
              "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": "stl_art/qwen"}},
    }
    if lightning:
        wf["11"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["1", 0], "lora_name": "Qwen-Image-Lightning-8steps-V1.1.safetensors", "strength_model": 1.0}}
        wf["4"]["inputs"]["model"] = ["11", 0]
        wf["8"]["inputs"].update(steps=8, cfg=1.0)
    return wf


def flux_wf(prompt, seed, w, h, steps=28, lora="schoonover1_cap_d6a3e11.safetensors", lora_s=0.8):
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux1-dev.sft", "weight_dtype": "fp8_e4m3fn"}},
        "2": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "11": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["1", 0], "lora_name": "flux\\" + lora, "strength_model": lora_s}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": prompt + STYLE}},
        "12": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["5", 0], "guidance": 3.0}},
        "6": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "EmptySD3LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "8": {"class_type": "KSampler", "inputs": {"model": ["11", 0], "positive": ["12", 0], "negative": ["6", 0],
              "latent_image": ["7", 0], "seed": seed, "steps": steps, "cfg": 1.0,
              "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": "stl_art/flux"}},
    }


def zimage_wf(prompt, seed, w, h, steps=9, shift=3.0):
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "z_image_turbo_bf16.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "lumina2", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "4": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": shift}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": prompt + STYLE}},
        "6": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "EmptySD3LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "8": {"class_type": "KSampler", "inputs": {"model": ["4", 0], "positive": ["5", 0], "negative": ["6", 0],
              "latent_image": ["7", 0], "seed": seed, "steps": steps, "cfg": 1.0,
              "sampler_name": "res_multistep", "scheduler": "simple", "denoise": 1.0}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": "stl_art/zimg"}},
    }


def post(wf):
    data = json.dumps({"prompt": wf, "client_id": "stl-art"}).encode()
    req = urllib.request.Request(URL + "/prompt", data=data, headers={"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req))["prompt_id"]
    except urllib.error.HTTPError as e:
        print(e.read().decode()); raise


def wait(pid, timeout=1800):
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = json.load(urllib.request.urlopen(f"{URL}/history/{pid}"))
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error":
                print(json.dumps(st)[:2000]); return None
            if st.get("completed"):
                return h[pid]["outputs"]
        time.sleep(3)
    return None


def fetch(outputs, dest):
    for node in outputs.values():
        for im in node.get("images", []):
            q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im["subfolder"], "type": im["type"]})
            with urllib.request.urlopen(f"{URL}/view?{q}") as r, open(dest, "wb") as f:
                f.write(r.read())
            return dest


if __name__ == "__main__":
    # usage: gen.py jobs.json [name ...]  (list of {name, prompt, model, seed?, w, h, ...}; names pick a subset)
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    only = set(sys.argv[2:])
    for j in jobs:
        if only and j["name"] not in only:
            continue
        seed = j.get("seed", random.randint(1, 2**31))
        w, h = j.get("w", 1664), j.get("h", 928)
        if j.get("model") == "zimage":
            wf = zimage_wf(j["prompt"], seed, w, h, **j.get("kw", {}))
        elif j.get("model", "qwen") == "flux":
            wf = flux_wf(j["prompt"], seed, w, h, **j.get("kw", {}))
        else:
            wf = qwen_wf(j["prompt"], seed, w, h, **j.get("kw", {}))
        t = time.time()
        pid = post(wf)
        out = wait(pid)
        dest = os.path.join(OUT, f"{j['name']}.png")
        if out:
            fetch(out, dest)
            print(f"OK {j['name']} seed={seed} {time.time()-t:.0f}s -> {dest}", flush=True)
        else:
            print(f"FAIL {j['name']}", flush=True)
