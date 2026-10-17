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

/**
 * Musical stings: played straight (no random detune, which would put them out of tune) and the music bed
 * ducks under them for their length.
 */
const STINGS = new Set(['fanfare', 'defeat']);

/** Play a one-shot effect (a random variant if there are several). Silent if the sound was not loaded. */
export function playSfx(scene: Phaser.Scene, name: string, volume = 0.6): void {
  const keys = variants(scene, name);
  if (!keys.length) return;
  const sting = STINGS.has(name);
  const sound = scene.sound.add(keys[Math.floor(Math.random() * keys.length)]);
  sound.once(Phaser.Sound.Events.COMPLETE, () => sound.destroy());
  sound.play({ volume, detune: sting ? 0 : (Math.random() - 0.5) * 200 });
  if (sting) director?.duck(sound.duration);
}

/** Start a looping sound shared by all scenes, unless it is already playing. */
export function playLoop(scene: Phaser.Scene, name: string, volume = 0.3): void {
  if (director?.owns(name)) return; // music follows the scene on its own
  const key = soundKey(name);
  if (!scene.cache.audio.exists(key)) return;
  const existing = scene.sound.getAll(key);
  if (existing.some((s) => s.isPlaying)) return;
  const sound = existing[0] ?? scene.sound.add(key, { loop: true, volume });
  sound.play({ loop: true, volume });
}

export function stopLoop(scene: Phaser.Scene, name: string): void {
  if (director?.owns(name)) return;
  for (const s of scene.sound.getAll(soundKey(name))) s.stop();
}

// ---------------------------------------------------------------------------------------------------------------
// Music director: one bed of music per kind of screen, crossfaded as the active scene changes.

/** Which music each scene wants, best first; the first one the manifest lists is used. */
const SCENE_MUSIC: Record<string, string[]> = {
  Title: ['shanty'],
  ShipSelect: ['shanty'],
  Logbook: ['shanty'],
  SeaMap: ['music-sea'],
  Event: ['music-sea'],
  Result: ['music-sea'],
  RunEnd: ['music-sea'],
  Port: ['music-port', 'music-sea'],
  Battle: ['music-battle'],
};
/** Playback level of each track (before the player's loud/soft/mute setting), so beds sit under the effects. */
const MUSIC_LEVEL: Record<string, number> = { shanty: 0.35, 'music-sea': 0.4, 'music-port': 0.38, 'music-battle': 0.36 };
const DEFAULT_LEVEL = 0.38;
/** Seconds for a bed to fade fully in or out. */
const FADE_IN = 2.5;
const FADE_OUT = 1.6;
/** Level a bed drops to under a sting, and how quickly it comes back. */
const DUCK = 0.3;
const DIRECTOR_KEY = 'MusicDirector';

/** The scene keys whose music the director picks: exported for tests and tools. */
export function musicForScene(sceneKey: string, available: readonly string[]): string | null {
  return (SCENE_MUSIC[sceneKey] ?? []).find((name) => available.includes(name)) ?? null;
}

interface Track {
  name: string;
  sound: Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound | Phaser.Sound.NoAudioSound;
  /** Current gain, 0..1 of the track's level. */
  gain: number;
}

/**
 * An invisible scene that runs alongside the others. It never draws; it watches which scene is active, loads that
 * scene's music in the background (so no screen waits for megabytes of audio), and crossfades between beds.
 * The player's mute and loud/soft settings apply through the game's sound manager, as for every other sound.
 */
class MusicDirector extends Phaser.Scene {
  /** Track names ("shanty", "music-sea") mapped to their file names. */
  files = new Map<string, string>();
  private tried = new Set<string>();
  private tracks = new Map<string, Track>();
  private wanted: string | null = null;
  private loading: string | null = null;
  private queue: string[] = [];
  private duckUntil = 0;
  private duckGain = 1;

  constructor() {
    super({ key: DIRECTOR_KEY, active: false });
  }

  create(): void {
    this.scene.sendToBack();
    // Fetch the other beds one at a time, a little after the first screen is up.
    this.time.delayedCall(4000, () => {
      for (const f of this.files.keys()) if (!this.queue.includes(f)) this.queue.push(f);
      this.pump();
    });
  }

  /** True for any music file the director manages, whether or not it has loaded yet. */
  owns(name: string): boolean {
    return this.files.has(name);
  }

  duck(seconds: number): void {
    this.duckUntil = Math.max(this.duckUntil, this.time.now + Math.max(1, seconds) * 1000);
  }

  private activeScene(): string | null {
    const scenes = this.game.scene.getScenes(true);
    for (let i = scenes.length - 1; i >= 0; i--) {
      const key = scenes[i].scene.key;
      if (key !== DIRECTOR_KEY && key !== 'Preload') return key;
    }
    return null;
  }

  /** Load one music file at a time; the one the current scene wants jumps the queue. */
  private pump(): void {
    if (this.loading) return;
    const next = this.queue.shift();
    if (!next) return;
    const key = soundKey(next);
    if (this.tried.has(next) || this.cache.audio.exists(key)) return this.pump();
    this.tried.add(next);
    this.loading = next;
    const done = (): void => {
      this.load.off(Phaser.Loader.Events.COMPLETE, done);
      this.loading = null;
      this.pump();
    };
    this.load.on(Phaser.Loader.Events.COMPLETE, done);
    this.load.audio(key, `audio/${this.files.get(next)}`);
    this.load.start();
  }

  update(_time: number, delta: number): void {
    const scene = this.activeScene();
    if (scene) this.wanted = musicForScene(scene, [...this.files.keys()]);
    const want = this.wanted;
    if (want && !this.tried.has(want) && this.loading !== want) {
      this.queue = [want, ...this.queue.filter((f) => f !== want)];
      this.pump();
    }
    // Browsers keep audio locked until the first click or key press; start nothing until then.
    if (this.sound.locked) return;
    if (want && !this.tracks.has(want) && this.cache.audio.exists(soundKey(want))) {
      const sound = this.sound.add(soundKey(want), { loop: true, volume: 0 });
      sound.play({ loop: true, volume: 0 });
      this.tracks.set(want, { name: want, sound, gain: 0 });
    }
    const dt = delta / 1000;
    const ducked = this.time.now < this.duckUntil;
    this.duckGain = ducked ? Math.max(DUCK, this.duckGain - dt / 0.3) : Math.min(1, this.duckGain + dt / 1.5);
    for (const t of this.tracks.values()) {
      const target = t.name === want ? 1 : 0;
      if (target > t.gain) t.gain = Math.min(target, t.gain + dt / FADE_IN);
      else t.gain = Math.max(target, t.gain - dt / FADE_OUT);
      if (target === 1 && t.sound.isPaused) t.sound.resume();
      const level = (MUSIC_LEVEL[t.name] ?? DEFAULT_LEVEL) * t.gain * this.duckGain;
      (t.sound as Phaser.Sound.WebAudioSound).setVolume(level);
      // A bed that has faded out waits, paused, to pick up where it left off when its scene comes back.
      if (t.gain === 0 && target === 0 && t.sound.isPlaying) t.sound.pause();
    }
  }
}

let director: MusicDirector | null = null;

/**
 * Start the music director (once). `files` are the music files the audio manifest lists under "music"
 * ("shanty.ogg", "music-sea.ogg"...); they load in the background, never on the loading screen.
 */
export function installMusicDirector(game: Phaser.Game, files: string[]): void {
  if (director || !files.length) return;
  const scene = game.scene.add(DIRECTOR_KEY, MusicDirector, true) as MusicDirector;
  for (const f of files) scene.files.set(f.replace(/\.[a-z0-9]+$/i, ''), f);
  director = scene;
}
