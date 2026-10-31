/**
 * The player's settings that outlast a visit: the mixer's levels and the speed words are written out at. Pure (no
 * Phaser): every function takes the storage it reads, so the tests can hand it a fake one.
 */

/** The parts of localStorage used here. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's storage, or null where it is blocked (private windows, sandboxed frames). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// --- Audio ---------------------------------------------------------------------

/** The mixer's buses under the master: each sound plays on one. */
export type Bus = 'music' | 'effects' | 'ambience' | 'ui';
export const BUSES: readonly Bus[] = ['music', 'effects', 'ambience', 'ui'];

/** Slider positions, 0..1 (see sliderGain for what they do to the sound), and the quick mute. */
export interface AudioPrefs {
  master: number;
  music: number;
  effects: number;
  ambience: number;
  ui: number;
  muted: boolean;
}

/** Full level everywhere but the interface ticks: the game's sounds are balanced against each other already. */
export const AUDIO_DEFAULTS: Readonly<AudioPrefs> = { master: 1, music: 1, effects: 1, ambience: 0.9, ui: 0.8, muted: false };

export const AUDIO_KEY = 'stl:audio';
/** The old speaker button's settings: muted ('1') and loud or soft. Read once, to carry them over. */
export const OLD_MUTE_KEY = 'slower-than-light.muted';
export const OLD_VOLUME_KEY = 'slower-than-light.volume';
/** The old "soft" setting played everything at 0.4: the master slider position that gives the same gain. */
export const SOFT_MASTER = Math.sqrt(0.4);

const clamp01 = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback);

/** The remembered levels; the first time, the old mute and loud/soft settings carried over (and the old keys cleared). */
export function loadAudioPrefs(store: KeyValueStore | null): AudioPrefs {
  const prefs: AudioPrefs = { ...AUDIO_DEFAULTS };
  if (!store) return prefs;
  let raw: string | null = null;
  try {
    raw = store.getItem(AUDIO_KEY);
  } catch {
    return prefs;
  }
  if (raw) {
    try {
      const saved = JSON.parse(raw) as Partial<Record<keyof AudioPrefs, unknown>>;
      for (const k of ['master', ...BUSES] as const) prefs[k] = clamp01(saved[k], AUDIO_DEFAULTS[k]);
      prefs.muted = saved.muted === true;
    } catch {
      // A damaged entry: back to the defaults.
    }
    return prefs;
  }
  // First run of the mixer: carry over the speaker button's settings.
  try {
    prefs.muted = store.getItem(OLD_MUTE_KEY) === '1';
    if (store.getItem(OLD_VOLUME_KEY) === 'soft') prefs.master = SOFT_MASTER;
    if (store.getItem(OLD_MUTE_KEY) !== null || store.getItem(OLD_VOLUME_KEY) !== null) {
      saveAudioPrefs(store, prefs);
      store.removeItem(OLD_MUTE_KEY);
      store.removeItem(OLD_VOLUME_KEY);
    }
  } catch {
    // Storage refused: the defaults stand for this visit.
  }
  return prefs;
}

export function saveAudioPrefs(store: KeyValueStore | null, prefs: AudioPrefs): void {
  try {
    store?.setItem(AUDIO_KEY, JSON.stringify(prefs));
  } catch {
    // Fine: it just won't be remembered.
  }
}

/** A slider position to a gain. Squared, so the slider's travel feels even to the ear (half way is about -12 dB). */
export function sliderGain(v: number): number {
  const c = Math.max(0, Math.min(1, v));
  return c * c;
}

/** The gain of one bus under the master (which the sound manager applies, with the mute, to everything). */
export function busGain(prefs: AudioPrefs, bus: Bus): number {
  return sliderGain(prefs[bus]);
}

// --- Words ---------------------------------------------------------------------

/** How fast dialogue is written out. */
export type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';
export const TEXT_SPEEDS: readonly TextSpeed[] = ['slow', 'normal', 'fast', 'instant'];
export const TEXT_SPEED_NAMES: Record<TextSpeed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast', instant: 'Instant' };
export const TEXT_SPEED_KEY = 'stl:text-speed';

export function loadTextSpeed(store: KeyValueStore | null): TextSpeed {
  try {
    const v = store?.getItem(TEXT_SPEED_KEY);
    return TEXT_SPEEDS.includes(v as TextSpeed) ? (v as TextSpeed) : 'normal';
  } catch {
    return 'normal';
  }
}

export function saveTextSpeed(store: KeyValueStore | null, speed: TextSpeed): void {
  try {
    store?.setItem(TEXT_SPEED_KEY, speed);
  } catch {
    // Fine: it lasts for this visit.
  }
}

/** What the speed does to a typer's letters per second (Infinity: all at once). */
export function textSpeedFactor(speed: TextSpeed): number {
  return { slow: 0.6, normal: 1, fast: 1.8, instant: Infinity }[speed];
}

let textSpeed: TextSpeed | null = null;

/** The current text speed (read from storage the first time). */
export function currentTextSpeed(): TextSpeed {
  textSpeed ??= loadTextSpeed(browserStore());
  return textSpeed;
}

export function setTextSpeed(speed: TextSpeed): void {
  textSpeed = speed;
  saveTextSpeed(browserStore(), speed);
}
