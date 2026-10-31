import Phaser from 'phaser';

/**
 * Audio loading that skips a missing file quietly. Phaser's loader would log an error for each one, and the dev
 * server answers a missing file with its index page (status 200), which Phaser then fails to decode, loudly. Here a
 * file is fetched, checked to be audio, and decoded straight into the game's audio cache; anything else is a quiet
 * false, and the name simply plays nothing.
 */

/** Requests for the same key share one fetch. */
const pending = new Map<string, Promise<boolean>>();

/** Fetch and decode one audio file into the cache under `key`. True once it is there; false (quietly) if it cannot be. */
export function loadAudio(game: Phaser.Game, key: string, url: string): Promise<boolean> {
  if (game.cache.audio.exists(key)) return Promise.resolve(true);
  let p = pending.get(key);
  if (!p) {
    p = load(game, key, url).catch(() => false);
    pending.set(key, p);
    void p.then(() => pending.delete(key));
  }
  return p;
}

async function load(game: Phaser.Game, key: string, url: string): Promise<boolean> {
  const sound = game.sound;
  if (!sound || sound instanceof Phaser.Sound.NoAudioSoundManager) return false;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return false;
  }
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!res.ok || type.includes('text/') || type.includes('json')) return false;
  if (sound instanceof Phaser.Sound.WebAudioSoundManager) {
    const data = await res.arrayBuffer();
    if (data.byteLength < 64) return false;
    const buffer = await decode(sound.context, data);
    if (!buffer) return false;
    if (!game.cache.audio.exists(key)) game.cache.audio.add(key, buffer);
    return true;
  }
  // HTML5 Audio: the file is there (the fetch just warmed the browser's cache); let Phaser's loader make the elements.
  return loadHtml5(game, key, url);
}

function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer | null> {
  return new Promise((resolve) => {
    try {
      // The callback form, which every browser's decodeAudioData takes; some old ones return no promise.
      const p = ctx.decodeAudioData(
        data,
        (b) => resolve(b),
        () => resolve(null),
      ) as Promise<AudioBuffer> | undefined;
      p?.catch(() => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

function loadHtml5(game: Phaser.Game, key: string, url: string): Promise<boolean> {
  const scene = game.scene.getScenes(true)[0];
  if (!scene) return Promise.resolve(false);
  const load = scene.load;
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      load.off(`filecomplete-audio-${key}`, onFile);
      load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      resolve(ok && game.cache.audio.exists(key));
    };
    const onFile = () => done(true);
    const onError = (file: Phaser.Loader.File) => file.key === key && done(false);
    load.once(`filecomplete-audio-${key}`, onFile);
    load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    load.audio(key, url);
    if (!load.isLoading()) load.start();
    // A scene that shuts down mid-load never says; give up after a while.
    setTimeout(() => done(false), 20000);
  });
}

/** Load many files a few at a time; `each` is told how each one went. */
export async function loadAll(game: Phaser.Game, files: { key: string; url: string }[], each: (ok: boolean) => void, concurrency = 6): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++];
      each(await loadAudio(game, f.key, f.url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
}
