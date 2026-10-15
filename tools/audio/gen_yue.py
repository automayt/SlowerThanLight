"""gen_yue.py name:seed:abc(0/1):lyricsvariant ... -> tools/audio/raw/<name>.flac (YuE2 native, instrumental attempt)"""
import sys, os, time
sys.path.append(r"E:\ClaudeComfy\SlowerThanLight\tools\audio")
import gen_sfx as g

STYLE = ("instrumental, no vocals, sea shanty, celtic folk, fiddle, concertina, accordion, tin whistle, stomping rhythm, "
         "hand drum, upbeat, 6/8, lo-fi, vintage recording, vinyl crackle, warm")
LYRICS = {"empty": "", "inst": "[intro]\n\n[instrumental]\n\n[instrumental]\n\n[outro]\n"}


def wf(seed, use_abc, lyr, secs=70.0):
    w = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "yue2_3b_bf16.safetensors"}},
        "10": {"class_type": "YuE2GenerateMusic", "inputs": {"clip": ["1", 1], "style": STYLE, "lyrics": LYRICS[lyr], "abc": "",
               "seed": seed, "mode": "full", "max_duration": secs, "temperature": 1.0, "top_p": 0.95, "top_k": 100,
               "repetition_penalty": 1.2}},
        "4": {"class_type": "EmptyYuE2LatentAudio", "inputs": {"seconds": ["10", 1], "batch_size": 1}},
        "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["10", 0], "negative": ["10", 0],
              "latent_image": ["4", 0], "seed": seed, "steps": 32, "cfg": 1.0, "sampler_name": "euler",
              "scheduler": "simple", "denoise": 1.0}},
        "9": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "8": {"class_type": "SaveAudio", "inputs": {"audio": ["9", 0], "filename_prefix": "stl_audio/yue"}},
    }
    if use_abc:
        w["11"] = {"class_type": "YuE2GenerateABC", "inputs": {"clip": ["1", 1], "style": STYLE, "lyrics": LYRICS[lyr],
                   "seed": seed, "mode": "full", "max_abc_tokens": 8192, "temperature": 0.7, "top_p": 0.9, "top_k": 30,
                   "repetition_penalty": 1.005, "penalty_window": 100}}
        w["10"]["inputs"]["abc"] = ["11", 0]
        w["12"] = {"class_type": "PreviewAny", "inputs": {"source": ["11", 0]}}
    return w


if __name__ == '__main__':
  for spec in sys.argv[1:]:
      name, seed, abc, lyr = spec.split(":")
      t = time.time()
      out = g.wait(g.post(wf(int(seed), abc == "1", lyr)), timeout=3600)
      dest = os.path.join(g.OUT, name + ".flac")
      ok = out and g.fetch(out, dest)
      if out and abc == "1":
          for v in out.values():
              if "text" in v:
                  open(os.path.join(g.OUT, name + ".abc.txt"), "w", encoding="utf-8").write("".join(v["text"]))
      print(("OK " if ok else "FAIL ") + name, f"{time.time()-t:.0f}s", flush=True)
