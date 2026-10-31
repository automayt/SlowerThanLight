/**
 * The audio director's decisions, kept apart from Phaser so they can be tested: which bed of music and which layers
 * of ambience each screen wants in its present mood, how tense a battle is, where on the stereo stage a sound sits,
 * and how many copies of one effect may sound at once.
 */

// --- Names -----------------------------------------------------------------------
// Every file name the code asks for (without ".ogg"); public/audio/manifest.json lists them. A name whose file is
// missing plays nothing, quietly.

/**
 * Every effect in public/audio, by the name playSfx takes (variants such as cannon-1, cannon-2 share one name).
 * A name that is not loaded plays nothing, so a scene may call one before its file exists.
 */
export const SFX = {
  cannon: 'a gun fires',
  'cannon-heavy': 'a big gun fires (18-pounders, carronades, mortars)',
  chain: 'chain shot whirring through the air',
  grape: 'grapeshot rattling through rigging and bulwarks',
  hotshot: 'a heated ball sizzling as it flies',
  'hit-wood': 'a ball strikes timber',
  crit: 'a crunching critical hit',
  mast: 'a mast cracks and falls; a station wrecked outright',
  splash: 'a ball falls short into the sea',
  fire: 'flames take hold',
  hiss: 'a fire is put out',
  breach: 'the hull is holed',
  flood: 'water rushing in',
  pump: 'the pumps at work',
  explosion: 'a magazine goes up',
  boarders: 'boarders roar over the side',
  grapple: 'grappling hooks bite',
  swords: 'cutlasses clash (boarding, melee)',
  musket: 'a ragged musket volley (marines, boarding)',
  heal: 'the surgeon at work',
  hammer: 'a carpenter at work (repairs, an upgrade bought)',
  bell: 'the ship’s bell',
  click: 'a button',
  hover: 'the pointer over a button (very soft)',
  confirm: 'a choice made',
  cancel: 'backing out, or a button that cannot be pressed',
  coins: 'gold changes hands',
  recruit: 'a hand signs the articles',
  dice: 'dice rattle across a tavern table',
  tankard: 'tankards knock together',
  anchor: 'the anchor cable runs out (arriving in port)',
  gulls: 'gulls overhead',
  chart: 'a chart unrolls',
  thunder: 'thunder rolling',
  sail: 'canvas flaps and fills (making sail, leaving port, fleeing)',
  cheer: 'the crew cheers (victory, a prize taken)',
  sink: 'a hull goes down, groaning and gurgling (a ship sinks)',
  quill: 'a quill scratches the chart (plotting a course)',
  page: 'a logbook page turns',
  creak: 'timbers creaking (stands in for amb-deck)',
  waves: 'waves on the hull (stands in for amb-sea)',
  fanfare: 'victory sting; the music ducks under it',
  defeat: 'low defeat sting; the music ducks under it',
  prize: 'sting: a ship taken as a prize',
  strike: 'sting: she strikes her colours',
  discovery: 'sting: somewhere new found',
} as const;

/** Music beds: looping, lazy-loaded, crossfaded by the director. */
export const MUSIC = [
  'music-title',
  'music-harbour',
  'music-sea',
  'music-sea-tense',
  'music-port',
  'music-tavern',
  'music-battle',
  'music-battle-hot',
  'music-boss',
  // The old title shanty: the fallback for the title and the hideout.
  'shanty',
] as const;

/** Ambience loops, layered under the music, each with its own fade. */
export const AMBIENCE = ['amb-sea', 'amb-wind', 'amb-storm', 'amb-harbour', 'amb-tavern', 'amb-deck', 'amb-fire'] as const;

/**
 * Musical stings: one-shots on the music bus, played straight (no random detune, which would put them out of tune),
 * with the music ducking under them.
 */
export const STINGS = ['fanfare', 'defeat', 'prize', 'strike', 'discovery'] as const;

/** Every name the game asks the manifest for: effects (loaded up front) and beds (fetched as screens want them). */
export const SOUND_NAMES = { effects: Object.keys(SFX), beds: [...MUSIC, ...AMBIENCE] as string[] };

/** One-shots on the interface bus. */
export const UI_SOUNDS = ['click', 'hover', 'confirm', 'cancel'] as const;

/**
 * Ambience layers that fall back on a loop already loaded with the effects, and how loud to play it in their place
 * (the old waves and creak loops were mixed lower than the new beds will be).
 */
export const AMBIENCE_FALLBACK: Record<string, { name: string; scale: number }> = {
  'amb-sea': { name: 'waves', scale: 0.6 },
  'amb-deck': { name: 'creak', scale: 0.65 },
};

// --- Mood ------------------------------------------------------------------------

/** What the screen on show tells the director (see setMood). Reset to these whenever the screen changes. */
export interface Mood {
  /** Battle: the raw tension of the fight, 0..1 (battleTension); the director smooths it with hysteresis. */
  tension: number;
  /** A fight against a boss: the blockade, or Silas Crane. */
  boss: boolean;
  /** The chart or a hail with danger near: Crane, the fleet's storm, a battered hull. */
  tense: boolean;
  /** The tavern is open over the port. */
  tavern: boolean;
  /** Strength of the wind in the rigging, 0..1. */
  wind: number;
  /** How near the storm is, 0..1 (rain and thunder). */
  storm: number;
  /** How much of our ship is burning, 0..1. */
  fire: number;
  /** The game is paused (the battle's Space): the music dips. */
  paused: boolean;
}

export const DEFAULT_MOOD: Readonly<Mood> = { tension: 0, boss: false, tense: false, tavern: false, wind: 0.3, storm: 0, fire: 0, paused: false };

/** Which music a screen wants in a mood, best first. `hot` is the battle's hysteresis-gated "desperate" state. */
export function musicChoices(scene: string, mood: Mood, hot = false): string[] {
  switch (scene) {
    case 'Title':
    case 'Logbook':
    case 'CoopLobby':
      return ['music-title', 'shanty'];
    case 'Harbour':
      return ['music-harbour', 'shanty'];
    case 'SeaMap':
    case 'Event':
    case 'Hail':
      return mood.tense ? ['music-sea-tense', 'music-sea'] : ['music-sea'];
    case 'Result':
    case 'RunEnd':
      return ['music-sea'];
    case 'Port':
      return mood.tavern ? ['music-tavern', 'music-port', 'music-sea'] : ['music-port', 'music-sea'];
    case 'Battle':
      if (mood.boss) return ['music-boss', 'music-battle-hot', 'music-battle'];
      return hot ? ['music-battle-hot', 'music-battle'] : ['music-battle'];
    default:
      return [];
  }
}

/**
 * From a screen's choices, what to play now and what to fetch. Names that are not usable (not in the manifest, or
 * failed to load) are passed over. The best usable choice is fetched if it is not ready; meanwhile the best one that
 * is ready plays, so a screen is never silent while its own music is still on the way.
 */
export function pickTrack(choices: readonly string[], usable: (name: string) => boolean, ready: (name: string) => boolean): { play: string | null; fetch: string | null } {
  const ok = choices.filter(usable);
  return { play: ok.find(ready) ?? null, fetch: ok.length && !ready(ok[0]) ? ok[0] : null };
}

/** The ambience layers a screen wants, and each one's level (0..1, before the ambience bus). */
export function ambienceFor(scene: string, mood: Mood): Record<string, number> {
  const w = clamp01(mood.wind);
  const s = clamp01(mood.storm);
  switch (scene) {
    case 'Title':
      return { 'amb-sea': 0.35, 'amb-wind': 0.15 };
    case 'Harbour':
      return { 'amb-harbour': 0.5, 'amb-sea': 0.2 };
    case 'SeaMap':
      return { 'amb-sea': 0.4, 'amb-deck': 0.3, 'amb-wind': 0.12 + 0.5 * w, 'amb-storm': 0.7 * s };
    case 'Event':
    case 'Hail':
      return { 'amb-sea': 0.4, 'amb-deck': 0.3, 'amb-wind': 0.12 + 0.4 * w, 'amb-storm': 0.6 * s };
    case 'Port':
      return mood.tavern ? { 'amb-tavern': 0.6, 'amb-harbour': 0.12 } : { 'amb-harbour': 0.5, 'amb-sea': 0.18 };
    case 'Battle':
      return { 'amb-sea': 0.4, 'amb-deck': 0.3, 'amb-wind': 0.08 + 0.3 * w, 'amb-storm': 0.6 * s, 'amb-fire': 0.6 * clamp01(mood.fire) };
    case 'Result':
      return { 'amb-sea': 0.3, 'amb-deck': 0.2 };
    default:
      return {};
  }
}

/** Beds worth fetching ahead while a screen is up, for where the player is likely to go next. */
export const PREFETCH: Record<string, string[]> = {
  Title: ['music-harbour', 'amb-harbour'],
  Harbour: ['music-sea', 'amb-sea', 'amb-deck', 'amb-wind'],
  SeaMap: ['music-battle', 'music-port', 'amb-harbour', 'music-sea-tense', 'amb-storm'],
  Event: ['music-battle', 'music-sea'],
  Hail: ['music-battle', 'music-boss'],
  Port: ['music-tavern', 'amb-tavern', 'music-sea'],
  Battle: ['music-battle-hot', 'amb-fire', 'music-sea'],
  Result: ['music-sea'],
};

// --- Battle tension ----------------------------------------------------------------

/** The state of a fight that makes it tense, as fractions and counts (see battleMood in the render layer). */
export interface TensionInput {
  /** Our hull, 0..1 of her full hull. */
  hull: number;
  /** Hers. */
  enemyHull: number;
  /** Our crew still standing, 0..1 of those we started with. */
  crew: number;
  /** Her boarders aboard us. */
  boarders: number;
  /** Rooms burning aboard us. */
  fires: number;
  /** How much of our ship is full of water, 0..1. */
  flood: number;
  grappled?: boolean;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/**
 * How desperate the fight is, 0..1. Danger to us dominates (our hull, and falling behind her on hull); a close
 * finish (both ships low) and anything that needs the crew's hands at once (boarders, fire, flooding) add to it.
 * A fresh fight is calm; a ship taking a beating is hot; winning comfortably stays calm.
 */
export function battleTension(i: TensionInput): number {
  const hull = clamp01(i.hull);
  const her = clamp01(i.enemyHull);
  const danger = Math.pow(1 - hull, 1.3);
  const losing = Math.max(0, her - hull);
  const close = (1 - hull) * (1 - her);
  const crewLoss = 1 - clamp01(i.crew);
  const boarded = clamp01(i.boarders / 3);
  const fire = clamp01(i.fires / 3);
  const flood = clamp01(i.flood * 4);
  return clamp01(0.55 * danger + 0.35 * losing + 0.5 * close + 0.25 * crewLoss + 0.45 * boarded + 0.2 * fire + 0.2 * flood + (i.grappled ? 0.1 : 0));
}

/**
 * Smooths the raw tension and decides when the music turns desperate, with hysteresis so it doesn't flap: it rises
 * quickly and falls slowly, turns hot above `enter` and calm again only below `exit`, and once switched holds for
 * `dwell` seconds.
 */
export class TensionGauge {
  level = 0;
  hot = false;
  private since = Infinity;

  constructor(
    private readonly enter = 0.5,
    private readonly exit = 0.32,
    private readonly dwell = 8,
    private readonly rise = 1,
    private readonly fall = 4,
  ) {}

  /** Feed the raw tension; `dt` in seconds. Returns whether the music should be desperate. */
  update(raw: number, dt: number): boolean {
    const target = clamp01(raw);
    const tau = target > this.level ? this.rise : this.fall;
    this.level += (target - this.level) * (1 - Math.exp(-Math.max(0, dt) / tau));
    this.since += dt;
    if (this.since >= this.dwell) {
      if (!this.hot && this.level >= this.enter) {
        this.hot = true;
        this.since = 0;
      } else if (this.hot && this.level <= this.exit) {
        this.hot = false;
        this.since = 0;
      }
    }
    return this.hot;
  }

  reset(): void {
    this.level = 0;
    this.hot = false;
    this.since = Infinity;
  }
}

// --- Stereo and voices --------------------------------------------------------------

/** Stereo pan for a sound at design x (0..width): our ship on the left, hers on the right, never hard over. */
export function panFor(x: number, width = 1280, max = 0.6): number {
  if (!Number.isFinite(x)) return 0;
  const p = (x - width / 2) / (width / 2);
  return Math.max(-1, Math.min(1, p)) * max;
}

/** How many copies of one effect may sound at once, where it differs from the default. */
export const VOICE_CAPS: Record<string, number> = { cannon: 4, 'hit-wood': 4, splash: 3, hover: 1, click: 2 };

/**
 * Keeps a broadside from clipping: at most `cap` copies of one effect at once (a new one beyond that is dropped), and
 * a repeat within `window` ms of the last start plays quieter, a third within it not at all.
 */
export class VoiceLimiter {
  private readonly voices = new Map<string, { start: number; end: number }[]>();

  constructor(
    private readonly cap = 3,
    private readonly window = 40,
    private readonly caps: Record<string, number> = VOICE_CAPS,
  ) {}

  /** The gain to play a new voice of `name` at (0: drop it). An admitted voice is counted until `now + durationMs`. */
  admit(name: string, now: number, durationMs: number): number {
    const live = (this.voices.get(name) ?? []).filter((v) => v.end > now);
    const recent = live.filter((v) => now - v.start < this.window).length;
    let gain = 1;
    if (live.length >= (this.caps[name] ?? this.cap) || recent >= 2) gain = 0;
    else if (recent === 1) gain = 0.5;
    if (gain > 0) live.push({ start: now, end: now + Math.max(this.window, durationMs) });
    this.voices.set(name, live);
    return gain;
  }

  /** Voices of a name still sounding at `now`. */
  count(name: string, now: number): number {
    return (this.voices.get(name) ?? []).filter((v) => v.end > now).length;
  }
}
