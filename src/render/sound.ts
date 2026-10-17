import Phaser from 'phaser';

const MUTE_KEY = 'slower-than-light.muted';

/** Cache key for a sound file: "cannon-2.ogg" → "sfx:cannon-2". */
export function soundKey(file: string): string {
  return `sfx:${file.replace(/\.[a-z0-9]+$/i, '')}`;
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Flip the mute setting, remember it, and apply it to every sound playing. */
export function toggleMute(game: Phaser.Game): boolean {
  const muted = !isMuted();
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Fine: it just won't be remembered.
  }
  game.sound.mute = muted;
  return muted;
}

/** Every loaded variant of a sound: "cannon" matches cannon, cannon-1, cannon-2... */
function variants(scene: Phaser.Scene, name: string): string[] {
  const base = soundKey(name);
  return scene.cache.audio.getKeys().filter((k) => k === base || k.startsWith(`${base}-`));
}

/** Play a one-shot effect (a random variant if there are several). Silent if the sound was not loaded. */
export function playSfx(scene: Phaser.Scene, name: string, volume = 0.6): void {
  const keys = variants(scene, name);
  if (!keys.length) return;
  scene.sound.play(keys[Math.floor(Math.random() * keys.length)], { volume, detune: (Math.random() - 0.5) * 200 });
}

/** Start a looping sound shared by all scenes, unless it is already playing. */
export function playLoop(scene: Phaser.Scene, name: string, volume = 0.3): void {
  const key = soundKey(name);
  if (!scene.cache.audio.exists(key)) return;
  const existing = scene.sound.getAll(key);
  if (existing.some((s) => s.isPlaying)) return;
  const sound = existing[0] ?? scene.sound.add(key, { loop: true, volume });
  sound.play({ loop: true, volume });
}

export function stopLoop(scene: Phaser.Scene, name: string): void {
  for (const s of scene.sound.getAll(soundKey(name))) s.stop();
}
