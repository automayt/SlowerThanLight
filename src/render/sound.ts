import Phaser from 'phaser';
import { loadAll, loadAudio } from './audio/loader';
import { AMBIENCE_FALLBACK, ambienceFor, DEFAULT_MOOD, musicChoices, panFor, pickTrack, PREFETCH, SFX, STINGS, TensionGauge, UI_SOUNDS, VoiceLimiter, type Mood } from './audio/mix';
import { browserStore, busGain, loadAudioPrefs, saveAudioPrefs, sliderGain, type AudioPrefs, type Bus } from './prefs';

/**
 * The game's sound: a mixer (master over music, effects, ambience and interface buses, remembered between visits),
 * one-shot effects with variants, stereo placement and a voice limit, and the audio director, an invisible scene that
 * crossfades music beds and ambience layers to suit the screen on show and its mood (see setMood).
 *
 * Every sound is named by its file in public/audio without the extension ("cannon-2.ogg" is a variant of "cannon").
 * A name whose file is missing plays nothing, quietly, so code can call for sounds before they exist.
 */

/** Emitted on game.events whenever a level or the mute changes, so speaker icons and sliders can redraw. */
export const SOUND_CHANGED = 'sound-changed';

/** Cache key for a sound file: "cannon-2.ogg" → "sfx:cannon-2". */
export function soundKey(file: string): string {
  return `sfx:${file.replace(/\.[a-z0-9]+$/i, '')}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The mixer.

let prefs: AudioPrefs = loadAudioPrefs(browserStore());

/** The remembered levels (slider positions 0..1) and the mute. */
export function audioPrefs(): Readonly<AudioPrefs> {
  return prefs;
}

/** Change levels or the mute, remember them, and apply them to everything playing. */
export function setAudioPrefs(game: Phaser.Game, patch: Partial<AudioPrefs>): void {
  prefs = { ...prefs, ...patch };
  saveAudioPrefs(browserStore(), prefs);
  applySound(game);
}

/** Apply the remembered settings: the master and the mute to the sound manager, each bus to what it is playing. */
export function applySound(game: Phaser.Game): void {
  game.sound.mute = prefs.muted;
  game.sound.volume = sliderGain(prefs.master);
  for (const v of live) setVolume(v.sound, v.base * busGain(prefs, v.bus));
  game.events.emit(SOUND_CHANGED);
}

export function isMuted(): boolean {
  return prefs.muted;
}

/** True when sound is on but the master is turned well down (the speaker shows one arc). */
export function isSoft(): boolean {
  return prefs.master < 0.75;
}

/** Flip the mute, remember it, and apply it to every sound playing. */
export function toggleMute(game: Phaser.Game): boolean {
  setAudioPrefs(game, { muted: !prefs.muted });
  return prefs.muted;
}

/** The speaker button: a quick mute (the levels themselves live in the options). */
export function cycleVolume(game: Phaser.Game): void {
  toggleMute(game);
}

type AnySound = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound | Phaser.Sound.NoAudioSound;

function setVolume(sound: Phaser.Sound.BaseSound, v: number): void {
  (sound as AnySound).setVolume(v);
}

/** One-shots still sounding, so a level change reaches them. */
const live = new Set<{ sound: Phaser.Sound.BaseSound; base: number; bus: Bus }>();

// ---------------------------------------------------------------------------------------------------------------
// One-shot effects.

/** Every effect, by the name playSfx takes, and what it is for (see audio/mix.ts). */
export { SFX };

const STING_SET = new Set<string>(STINGS);
const UI_SET = new Set<string>(UI_SOUNDS);
const limiter = new VoiceLimiter();

export interface SfxOptions {
  /** Playback level before the bus (default 0.6). */
  volume?: number;
  /** Stereo pan, -1..1; or give `x`, the source's design x, and it is worked out (our ship left, hers right). */
  pan?: number;
  x?: number;
  /** Which bus: by default stings go on music, click/hover/confirm/cancel on the interface, everything else on effects. */
  bus?: Bus;
  /** Random detune (default on, except for stings): no two cannon sound quite alike. */
  detune?: boolean;
}

/** The loaded variants of a sound: "cannon" matches cannon, cannon-1, cannon-2 (not cannon-heavy). */
function variants(scene: Phaser.Scene, name: string): string[] {
  const base = soundKey(name);
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-\\d+)?$`);
  return scene.cache.audio.getKeys().filter((k) => re.test(k));
}

/** Whether a sound is loaded (any variant). */
export function hasSfx(scene: Phaser.Scene, name: string): boolean {
  return variants(scene, name).length > 0;
}

/**
 * Play a one-shot effect: a random variant if there are several, the first name of a list that is loaded (so a new
 * sound can fall back on an old one), placed in stereo and limited so a broadside doesn't clip. Silent if nothing
 * is loaded. `opts` may be just the volume, as before.
 */
export function playSfx(scene: Phaser.Scene, name: string | readonly string[], opts: number | SfxOptions = 0.6): void {
  const o: SfxOptions = typeof opts === 'number' ? { volume: opts } : opts;
  let pick = '';
  let keys: string[] = [];
  for (const n of typeof name === 'string' ? [name] : name) {
    keys = variants(scene, n);
    if (keys.length) {
      pick = n;
      break;
    }
  }
  if (!keys.length || !scene.sys?.game) return;
  const sting = STING_SET.has(pick);
  const bus: Bus = o.bus ?? (sting ? 'music' : UI_SET.has(pick) ? 'ui' : 'effects');
  const sound = scene.sound.add(keys[Math.floor(Math.random() * keys.length)]);
  const gain = sting ? 1 : limiter.admit(pick, performance.now(), sound.duration * 1000);
  if (gain <= 0) {
    sound.destroy();
    return;
  }
  const base = (o.volume ?? 0.6) * gain;
  const voice = { sound, base, bus };
  live.add(voice);
  const end = () => {
    live.delete(voice);
    sound.destroy();
  };
  sound.once(Phaser.Sound.Events.COMPLETE, end);
  sound.once(Phaser.Sound.Events.DESTROY, () => live.delete(voice));
  const detune = o.detune ?? !sting;
  sound.play({ volume: base * busGain(prefs, bus), detune: detune ? (Math.random() - 0.5) * 200 : 0, pan: o.pan ?? (o.x !== undefined ? panFor(o.x) : 0) });
  if (sting) director?.duck(sound.duration);
}

let lastHover = 0;

/** The soft tick of the pointer over a button: throttled, so sweeping across a row doesn't chatter. */
export function playHover(scene: Phaser.Scene): void {
  const now = performance.now();
  if (now - lastHover < 70) return;
  lastHover = now;
  playSfx(scene, 'hover', { volume: 0.25, detune: false });
}

/** Start a looping sound shared by all scenes, unless it is already playing (beds and ambience are the director's). */
export function playLoop(scene: Phaser.Scene, name: string, volume = 0.3): void {
  if (director?.owns(name)) return;
  const key = soundKey(name);
  if (!scene.cache.audio.exists(key)) return;
  const existing = scene.sound.getAll(key);
  if (existing.some((s) => s.isPlaying)) return;
  const sound = existing[0] ?? scene.sound.add(key, { loop: true, volume });
  sound.play({ loop: true, volume: volume * busGain(prefs, 'ambience') });
}

export function stopLoop(scene: Phaser.Scene, name: string): void {
  if (director?.owns(name)) return;
  for (const s of scene.sound.getAll(soundKey(name))) s.stop();
}

/** Load the effects the manifest lists (quietly skipping any that are missing); `progress` hears 0..1. */
export function preloadSfx(game: Phaser.Game, files: string[], progress: (k: number) => void = () => {}): Promise<void> {
  let done = 0;
  if (!files.length) {
    progress(1);
    return Promise.resolve();
  }
  return loadAll(
    game,
    files.map((f) => ({ key: soundKey(f), url: `audio/${f}` })),
    () => progress(++done / files.length),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Mood.

/**
 * Tell the director how things stand on a screen: a battle's tension, a boss, danger near on the chart, the tavern
 * open, the wind and the storm, fire aboard, the game paused. Only the fields given change; a screen's mood goes back
 * to calm (DEFAULT_MOOD) each time it starts. Cheap enough to call every frame.
 */
export function setMood(scene: Phaser.Scene, patch: Partial<Mood>): void {
  director?.setMood(scene.scene.key, patch);
}

/** The options are open over the game: the music dips. */
export function setMenuOpen(_game: Phaser.Game, open: boolean): void {
  director?.setMenu(open);
}

// ---------------------------------------------------------------------------------------------------------------
// The audio director: music beds and ambience layers, crossfaded as the screen and its mood change.

/** Playback level of each bed (before the music bus and master), so beds sit under the effects. */
const MUSIC_LEVEL: Record<string, number> = {
  shanty: 0.35,
  'music-title': 0.4,
  'music-harbour': 0.38,
  'music-sea': 0.4,
  'music-sea-tense': 0.4,
  'music-port': 0.38,
  'music-tavern': 0.4,
  'music-battle': 0.36,
  'music-battle-hot': 0.38,
  'music-boss': 0.4,
};
const DEFAULT_LEVEL = 0.38;
/** Seconds for a bed to fade fully in or out; ambience moves more slowly. */
const FADE_IN = 2.5;
const FADE_OUT = 1.6;
const AMB_FADE = 2.2;
/** Level the music drops to under a sting, and while the game is paused or the options are open. */
const DUCK = 0.3;
const DIP = 0.55;
/** Most beds (music and ambience) kept decoded at once: a decoded three-minute bed is ~50 MB. */
const MAX_BEDS = 8;
const DIRECTOR_KEY = 'AudioDirector';
/** Scenes that are not screens of their own. */
const NOT_SCREENS = new Set([DIRECTOR_KEY, 'Preload', 'CoopDirector', 'Options', 'Transition']);

interface Bed {
  /** The file playing (an ambience layer may be standing in with a fallback). */
  name: string;
  sound: AnySound;
  /** Current fade, 0..1. */
  gain: number;
}

class AudioDirector extends Phaser.Scene {
  /** Bed names ("music-sea", "amb-wind") mapped to their files, from the manifest. */
  readonly files = new Map<string, string>();
  /** Beds that could not be loaded. */
  private readonly failed = new Set<string>();
  private readonly music = new Map<string, Bed>();
  private readonly ambience = new Map<string, Bed>();
  /** When each bed was last wanted, for evicting the stalest when too many are decoded. */
  private readonly lastWanted = new Map<string, number>();
  private loading: string | null = null;
  private queue: string[] = [];
  private screen: string | null = null;
  /** Each screen's mood, by scene key. */
  private readonly moods = new Map<string, Mood>();
  private readonly gauge = new TensionGauge();
  private menu = false;
  private duckUntil = 0;
  private duckGain = 1;
  private dipGain = 1;
  private prefetchAt = 0;

  constructor() {
    super({ key: DIRECTOR_KEY, active: false });
  }

  create(): void {
    this.scene.sendToBack();
  }

  /** True for any bed the director manages, whether or not it has loaded. */
  owns(name: string): boolean {
    return this.files.has(name);
  }

  duck(seconds: number): void {
    this.duckUntil = Math.max(this.duckUntil, this.time.now + Math.max(1, seconds) * 1000);
  }

  setMood(key: string, patch: Partial<Mood>): void {
    const mood = this.moods.get(key) ?? { ...DEFAULT_MOOD };
    this.moods.set(key, Object.assign(mood, patch));
  }

  /** A screen starting afresh starts calm. */
  resetMood(key: string): void {
    this.moods.delete(key);
    if (key === 'Battle') this.gauge.reset();
  }

  setMenu(open: boolean): void {
    this.menu = open;
  }

  /** The screen on show: the top-most game scene that is running, or paused under the options. */
  private activeScreen(): string | null {
    const scenes = this.game.scene.getScenes(false);
    for (let i = scenes.length - 1; i >= 0; i--) {
      const s = scenes[i];
      const status = s.sys.settings.status;
      if (NOT_SCREENS.has(s.scene.key) || status < Phaser.Scenes.CREATING || status > Phaser.Scenes.PAUSED) continue;
      return s.scene.key;
    }
    return null;
  }

  private usable = (name: string): boolean => this.files.has(name) && !this.failed.has(name);
  private ready = (name: string): boolean => this.cache.audio.exists(soundKey(name));

  /** Fetch a bed; ones wanted now jump the queue. */
  private want(name: string, urgent: boolean): void {
    if (!this.usable(name) || this.ready(name) || this.loading === name) return;
    this.queue = this.queue.filter((n) => n !== name);
    if (urgent) this.queue.unshift(name);
    else this.queue.push(name);
    this.pump();
  }

  /** Load one bed at a time. */
  private pump(): void {
    if (this.loading) return;
    const next = this.queue.shift();
    if (!next) return;
    if (!this.usable(next) || this.ready(next)) return this.pump();
    this.loading = next;
    void loadAudio(this.game, soundKey(next), `audio/${this.files.get(next)}`).then((ok) => {
      if (!ok) this.failed.add(next);
      this.loading = null;
      if (ok) this.evict();
      this.pump();
    });
  }

  /** Drop the stalest silent beds once too many are decoded. */
  private evict(): void {
    const loaded = [...this.files.keys()].filter(this.ready);
    if (loaded.length <= MAX_BEDS) return;
    const audible = new Set([...this.music.values(), ...this.ambience.values()].filter((b) => b.gain > 0).map((b) => b.name));
    const stale = loaded.filter((n) => !audible.has(n)).sort((a, b) => (this.lastWanted.get(a) ?? 0) - (this.lastWanted.get(b) ?? 0));
    for (const name of stale.slice(0, loaded.length - MAX_BEDS)) {
      for (const beds of [this.music, this.ambience]) {
        const bed = beds.get(name);
        if (bed) {
          bed.sound.destroy();
          beds.delete(name);
        }
      }
      this.cache.audio.remove(soundKey(name));
    }
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(0.1, delta / 1000);
    const screen = this.activeScreen();
    if (screen !== this.screen) {
      this.screen = screen;
      this.prefetchAt = this.time.now + 1500;
    }
    if (!screen) return;
    const mood = this.moods.get(screen) ?? DEFAULT_MOOD;
    const hot = screen === 'Battle' ? this.gauge.update(mood.tension, dt) : false;

    // Music: the screen's best bed that is ready, while its first choice loads.
    const { play, fetch } = pickTrack(musicChoices(screen, mood, hot), this.usable, this.ready);
    if (fetch) this.want(fetch, true);
    if (play) this.lastWanted.set(play, this.time.now);

    // Ambience: each layer at its level, or the loop standing in for it.
    const layers = new Map<string, number>();
    for (const [layer, level] of Object.entries(ambienceFor(screen, mood))) {
      if (level <= 0.001) continue;
      if (this.usable(layer)) {
        this.want(layer, true);
        if (this.ready(layer)) {
          layers.set(layer, level);
          this.lastWanted.set(layer, this.time.now);
          continue;
        }
      }
      const fb = AMBIENCE_FALLBACK[layer];
      if (fb && this.cache.audio.exists(soundKey(fb.name))) layers.set(fb.name, level * fb.scale);
    }

    // Then what is likely next, once the screen's own beds are in hand.
    if (this.prefetchAt && this.time.now > this.prefetchAt && !this.loading) {
      this.prefetchAt = 0;
      for (const n of PREFETCH[screen] ?? []) this.want(n, false);
    }

    // Browsers keep audio locked until the first click or key press; start nothing until then.
    if (this.sound.locked) return;
    const ducked = this.time.now < this.duckUntil;
    this.duckGain = ducked ? Math.max(DUCK, this.duckGain - dt / 0.3) : Math.min(1, this.duckGain + dt / 1.5);
    const dip = this.menu || mood.paused ? DIP : 1;
    this.dipGain += (dip - this.dipGain) * Math.min(1, dt * 3);

    if (play && !this.music.has(play)) this.music.set(play, this.start(play, false));
    const musicBus = busGain(prefs, 'music') * this.duckGain * this.dipGain;
    for (const bed of this.music.values()) {
      const target = bed.name === play ? 1 : 0;
      bed.gain = target > bed.gain ? Math.min(target, bed.gain + dt / FADE_IN) : Math.max(target, bed.gain - dt / FADE_OUT);
      this.mix(bed, target, (MUSIC_LEVEL[bed.name] ?? DEFAULT_LEVEL) * bed.gain * musicBus);
    }

    for (const name of layers.keys()) if (!this.ambience.has(name)) this.ambience.set(name, this.start(name, true));
    const ambBus = busGain(prefs, 'ambience') * (0.6 + 0.4 * this.duckGain) * (this.menu ? 0.7 : 1);
    for (const bed of this.ambience.values()) {
      const level = layers.get(bed.name) ?? 0;
      // Fade toward the layer's level (which the mood moves smoothly, so wind and fire swell and die away).
      const step = dt / AMB_FADE;
      bed.gain = level > bed.gain ? Math.min(level, bed.gain + step) : Math.max(level, bed.gain - step);
      this.mix(bed, level > 0 ? 1 : 0, bed.gain * ambBus);
    }
  }

  /** A bed starts silent and loops; ambience starts somewhere in its loop, so two screens never sound alike. */
  private start(name: string, ambience: boolean): Bed {
    const sound = this.sound.add(soundKey(name), { loop: true, volume: 0 }) as AnySound;
    const seek = ambience && sound.duration > 4 ? Math.random() * (sound.duration - 2) : 0;
    sound.play({ loop: true, volume: 0, seek });
    return { name, sound, gain: 0 };
  }

  /** Set a bed's level; one faded out waits, paused, to pick up where it left off when it is wanted again. */
  private mix(bed: Bed, target: number, volume: number): void {
    if (target > 0 && bed.sound.isPaused) bed.sound.resume();
    bed.sound.setVolume(volume);
    if (bed.gain === 0 && target === 0 && bed.sound.isPlaying) bed.sound.pause();
  }
}

let director: AudioDirector | null = null;

/**
 * Start the audio director (once). `music` and `ambience` are the files the audio manifest lists under those names
 * ("music-sea.ogg", "amb-wind.ogg"...); they load in the background as screens want them, never on the loading screen.
 */
export function installAudio(game: Phaser.Game, music: string[], ambience: string[]): void {
  if (director) return;
  const scene = game.scene.add(DIRECTOR_KEY, AudioDirector, true) as AudioDirector;
  for (const f of [...music, ...ambience]) scene.files.set(f.replace(/\.[a-z0-9]+$/i, ''), f);
  director = scene;
  for (const s of game.scene.scenes) s.events.on(Phaser.Scenes.Events.START, () => scene.resetMood(s.scene.key));
}
