"""gen_sound2.py jobs_sound2.json [kind ...] [--only name,name] [--takes N] -> raw/v2/<name>[-v]_t<k>.flac

Second sound pass, with dedicated audio models instead of LTX's video soundtrack:
- music and stings: ACE-Step 1.5 XL turbo (8 steps, no CFG), instrumental ("[Instrumental]" lyrics);
- ambience and effects: Stable Audio 3 medium (8-step lcm), prompted directly (the template's Qwen re-prompt is skipped).
Each file gets `takes` candidates with different seeds; pick_sound2.py keeps the best by CLAP text-audio match.
Models live in E:/ComfyUI/models.
"""
import json, os, sys, time, zlib
from gen_sfx import post, wait, fetch

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "raw", "v2")
os.makedirs(OUT, exist_ok=True)
TAKES = {"music": 2, "sting": 4, "amb": 2, "sfx": 3}


def ace(j, seed):
    return {
        "104": {"class_type": "UNETLoader", "inputs": {"unet_name": "acestep_v1.5_xl_turbo_bf16.safetensors", "weight_dtype": "default"}},
        "106": {"class_type": "VAELoader", "inputs": {"vae_name": "ace_1.5_vae.safetensors"}},
        "105": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "qwen_0.6b_ace15.safetensors", "clip_name2": "qwen_4b_ace15.safetensors", "type": "ace", "device": "default"}},
        "78": {"class_type": "ModelSamplingAuraFlow", "inputs": {"shift": 3, "model": ["104", 0]}},
        "94": {"class_type": "TextEncodeAceStepAudio1.5", "inputs": {
            "clip": ["105", 0], "tags": j["tags"], "lyrics": "[Instrumental]", "seed": seed, "bpm": j["bpm"],
            "duration": float(j["seconds"]), "timesignature": j.get("time", "4"), "language": "en", "keyscale": j["key"],
            "generate_audio_codes": True, "cfg_scale": 2, "temperature": 0.85, "top_p": 0.9, "top_k": 0, "min_p": 0}},
        "47": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["94", 0]}},
        "98": {"class_type": "EmptyAceStep1.5LatentAudio", "inputs": {"seconds": float(j["seconds"]), "batch_size": 1}},
        "3": {"class_type": "KSampler", "inputs": {"model": ["78", 0], "seed": seed, "steps": 8, "cfg": 1, "sampler_name": "euler",
                                                    "scheduler": "simple", "denoise": 1, "positive": ["94", 0], "negative": ["47", 0], "latent_image": ["98", 0]}},
        "18": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["3", 0], "vae": ["106", 0]}},
        "111": {"class_type": "SaveAudio", "inputs": {"audio": ["18", 0], "filename_prefix": "stl_audio/ace"}},
    }


def sa3(j, seed):
    return {
        "25": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "stable_audio_3_medium.safetensors"}},
        "26": {"class_type": "CLIPLoader", "inputs": {"clip_name": "t5gemma_b_b_ul2.safetensors", "type": "stable_audio", "device": "default"}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["26", 0], "text": j["prompt"]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["26", 0], "text": ""}},
        "11": {"class_type": "EmptyLatentAudio", "inputs": {"seconds": float(j["seconds"]), "batch_size": 1}},
        "3": {"class_type": "KSampler", "inputs": {"model": ["25", 0], "seed": seed, "steps": 8, "cfg": 1, "sampler_name": "lcm",
                                                    "scheduler": "simple", "denoise": 1, "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["11", 0]}},
        "12": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["3", 0], "vae": ["25", 2]}},
        "57": {"class_type": "SaveAudio", "inputs": {"audio": ["12", 0], "filename_prefix": "stl_audio/sa3"}},
    }


def files_for(kind, j):
    n = j.get("variants", 0)
    names = [f"{j['name']}-{v}" for v in range(1, n + 1)] if n else [j["name"]]
    return names


if __name__ == "__main__":
    args = sys.argv[1:]
    only = set()
    takes_override = None
    if "--only" in args:
        i = args.index("--only"); only = set(args[i + 1].split(",")); del args[i:i + 2]
    if "--takes" in args:
        i = args.index("--takes"); takes_override = int(args[i + 1]); del args[i:i + 2]
    jobs = json.load(open(args[0], encoding="utf-8"))
    kinds = args[1:] or ["sting", "music", "amb", "sfx"]
    for kind in kinds:
        for j in jobs[kind]:
            if only and j["name"] not in only:
                continue
            takes = takes_override or TAKES[kind]
            for fi, fname in enumerate(files_for(kind, j)):
                for k in range(takes):
                    dest = os.path.join(OUT, f"{fname}_t{k}.flac")
                    if os.path.exists(dest):
                        continue
                    seed = zlib.crc32(f"{fname}/{k}".encode()) % 2**31
                    w = ace(j, seed) if kind in ("music", "sting") else sa3(j, seed)
                    t = time.time()
                    pid = post(w)
                    outs = wait(pid, timeout=3600)
                    if not outs:
                        print("FAILED", fname, k, flush=True)
                        continue
                    fetch(outs, dest)
                    json.dump({"seed": seed, "kind": kind, **j}, open(dest + ".json", "w"))
                    print(f"{kind} {fname} take {k} seed {seed} {time.time() - t:.0f}s", flush=True)
