import Phaser from 'phaser';

const MUTE_KEY = 'slower-than-light.muted';
const VOLUME_KEY = 'slower-than-light.volume';
/** Emitted on game.events whenever the mute or volume setting changes, so speaker icons can redraw. */
export const SOUND_CHANGED = 'sound-changed';
/** Volume when not muted: full, or soft for playing alongside something else. */
const LOUD = 1;
const SOFT = 0.4;

/** Cache key for a sound file: "cannon-2.ogg" → "sfx:cannon-2". */
export function soundKey(file: string): string {
  return `sfx:${file.replace(/\.[a-z0-9]+$/i, '')}`;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Fine: it just won't be remembered.
  }
}

export function isMuted(): boolean {
  return read(MUTE_KEY) === '1';
}

/** True when sound is on but turned down. */
export function isSoft(): boolean {
  return read(VOLUME_KEY) === 'soft';
}

/** Apply the remembered settings to the game's sound manager. */
export function applySound(game: Phaser.Game): void {
  game.sound.mute = isMuted();
  game.sound.volume = isSoft() ? SOFT : LOUD;
  game.events.emit(SOUND_CHANGED);
}

/** Flip the mute setting, remember it, and apply it to every sound playing. */
export function toggleMute(game: Phaser.Game): boolean {
  const muted = !isMuted();
  write(MUTE_KEY, muted ? '1' : '0');
  applySound(game);
  return muted;
}

/** The speaker button's cycle: loud, soft, off, and back to loud. */
export function cycleVolume(game: Phaser.Game): void {
  if (isMuted()) {
    write(MUTE_KEY, '0');
    write(VOLUME_KEY, 'loud');
  } else if (isSoft()) {
    write(MUTE_KEY, '1');
  } else {
    write(VOLUME_KEY, 'soft');
  }
  applySound(game);
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
