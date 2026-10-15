"""gen_sfx.py jobs.json -> raw/<name>.flac

Sound effects via LTX-2.3 (22B dev fp8 + distilled LoRA 0.5), a joint audio+video model:
a tiny throwaway video is generated alongside the audio and only the audio is kept.
Each job: {name, seconds, seed?, prompt}.  Single 8-step stage (stage 1 of the stock LTX-2.3 T2V graph).
"""
import json, os, sys, time, random, urllib.request, urllib.parse

URL = "http://127.0.0.1:8188"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "raw")
os.makedirs(OUT, exist_ok=True)
CKPT = "ltx-2.3-22b-dev-fp8.safetensors"
NEG = ("music, singing, speech, talking, voices, narration, melody, modern sounds, engine, electronic, "
       "pc game, console game, video game, cartoon, childish, ugly")
SIGMAS = "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0"
FPS = 24


def wf(prompt, seconds, seed, w=384, h=256):
    frames = max(9, int(round(seconds * FPS / 8)) * 8 + 1)
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "2": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["1", 0], "lora_name": "ltx-2.3-22b-distilled-lora-384.safetensors", "strength_model": 0.5}},
        "3": {"class_type": "LTXAVTextEncoderLoader", "inputs": {"text_encoder": "gemma_3_12B_it_fp4_mixed.safetensors", "ckpt_name": CKPT, "device": "default"}},
        "4": {"class_type": "LTXVAudioVAELoader", "inputs": {"ckpt_name": CKPT}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["3", 0], "text": prompt}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["3", 0], "text": NEG}},
        "7": {"class_type": "LTXVConditioning", "inputs": {"positive": ["5", 0], "negative": ["6", 0], "frame_rate": float(FPS)}},
        "8": {"class_type": "EmptyLTXVLatentVideo", "inputs": {"width": w, "height": h, "length": frames, "batch_size": 1}},
        "9": {"class_type": "LTXVEmptyLatentAudio", "inputs": {"audio_vae": ["4", 0], "frames_number": frames, "frame_rate": FPS, "batch_size": 1}},
        "10": {"class_type": "LTXVConcatAVLatent", "inputs": {"video_latent": ["8", 0], "audio_latent": ["9", 0]}},
        "11": {"class_type": "CFGGuider", "inputs": {"model": ["2", 0], "positive": ["7", 0], "negative": ["7", 1], "cfg": 1.0}},
        "12": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "13": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler_ancestral_cfg_pp"}},
        "14": {"class_type": "ManualSigmas", "inputs": {"sigmas": SIGMAS}},
        "15": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["12", 0], "guider": ["11", 0], "sampler": ["13", 0], "sigmas": ["14", 0], "latent_image": ["10", 0]}},
        "16": {"class_type": "LTXVSeparateAVLatent", "inputs": {"av_latent": ["15", 0]}},
        "17": {"class_type": "LTXVAudioVAEDecode", "inputs": {"samples": ["16", 1], "audio_vae": ["4", 0]}},
        "18": {"class_type": "SaveAudio", "inputs": {"audio": ["17", 0], "filename_prefix": "stl_audio/ltx"}},
    }


def post(w):
    data = json.dumps({"prompt": w, "client_id": "stl-audio"}).encode()
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
                print(json.dumps(st)[:3000]); return None
            if st.get("completed"):
                return h[pid]["outputs"]
        time.sleep(2)
    return None


def fetch(outputs, dest):
    for node in outputs.values():
        for a in node.get("audio", []):
            q = urllib.parse.urlencode({"filename": a["filename"], "subfolder": a["subfolder"], "type": a["type"]})
            with urllib.request.urlopen(f"{URL}/view?{q}") as r, open(dest, "wb") as f:
                f.write(r.read())
            return dest


if __name__ == "__main__":
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    for j in jobs:
        seed = j.get("seed", random.randint(1, 2**31))
        t = time.time()
        out = wait(post(wf(j["prompt"], j["seconds"], seed)))
        dest = os.path.join(OUT, j["name"] + ".flac")
        if out and fetch(out, dest):
            print(f"OK {j['name']} seed={seed} {time.time()-t:.0f}s", flush=True)
        else:
            print(f"FAIL {j['name']}", flush=True)
