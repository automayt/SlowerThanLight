import { describe, expect, it } from 'vitest';
import { ambienceFor, battleTension, DEFAULT_MOOD, musicChoices, panFor, pickTrack, TensionGauge, VoiceLimiter, type Mood, type TensionInput } from '../../src/render/audio/mix';
import {
  AUDIO_DEFAULTS,
  AUDIO_KEY,
  busGain,
  loadAudioPrefs,
  loadTextSpeed,
  OLD_MUTE_KEY,
  OLD_VOLUME_KEY,
  saveAudioPrefs,
  saveTextSpeed,
  sliderGain,
  SOFT_MASTER,
  textSpeedFactor,
  type KeyValueStore,
} from '../../src/render/prefs';

function memory(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

const mood = (patch: Partial<Mood> = {}): Mood => ({ ...DEFAULT_MOOD, ...patch });

describe('audio settings', () => {
  it('start at the defaults, with nothing stored or no storage at all', () => {
    expect(loadAudioPrefs(null)).toEqual(AUDIO_DEFAULTS);
    expect(loadAudioPrefs(memory())).toEqual(AUDIO_DEFAULTS);
  });

  it('carry over the old speaker settings once, and clear the old keys', () => {
    const store = memory({ [OLD_MUTE_KEY]: '1', [OLD_VOLUME_KEY]: 'soft' });
    const prefs = loadAudioPrefs(store);
    expect(prefs.muted).toBe(true);
    expect(prefs.master).toBeCloseTo(SOFT_MASTER);
    // The old soft setting played at 0.4: the same gain through the new slider curve.
    expect(sliderGain(prefs.master)).toBeCloseTo(0.4);
    expect(store.data[OLD_MUTE_KEY]).toBeUndefined();
    expect(store.data[OLD_VOLUME_KEY]).toBeUndefined();
    expect(JSON.parse(store.data[AUDIO_KEY]).muted).toBe(true);
    // Loud and unmuted carries over as the defaults.
    expect(loadAudioPrefs(memory({ [OLD_MUTE_KEY]: '0', [OLD_VOLUME_KEY]: 'loud' }))).toEqual(AUDIO_DEFAULTS);
  });

  it('round-trip through storage, clamped, and survive a damaged entry', () => {
    const store = memory();
    saveAudioPrefs(store, { ...AUDIO_DEFAULTS, music: 0.25, effects: 0.5, muted: true });
    expect(loadAudioPrefs(store)).toEqual({ ...AUDIO_DEFAULTS, music: 0.25, effects: 0.5, muted: true });
    expect(loadAudioPrefs(memory({ [AUDIO_KEY]: JSON.stringify({ master: 7, music: -1, ui: 'loud' }) }))).toEqual({ ...AUDIO_DEFAULTS, master: 1, music: 0 });
    expect(loadAudioPrefs(memory({ [AUDIO_KEY]: '{not json' }))).toEqual(AUDIO_DEFAULTS);
    // A saved mixer wins over any old keys still lying about.
    expect(loadAudioPrefs(memory({ [AUDIO_KEY]: JSON.stringify(AUDIO_DEFAULTS), [OLD_MUTE_KEY]: '1' })).muted).toBe(false);
  });

  it('a storage that throws is the defaults, not a crash', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    expect(loadAudioPrefs(broken)).toEqual(AUDIO_DEFAULTS);
    expect(() => saveAudioPrefs(broken, AUDIO_DEFAULTS)).not.toThrow();
  });

  it('sliders map to gain on a curve: silent at 0, full at 1, a quarter half way', () => {
    expect(sliderGain(0)).toBe(0);
    expect(sliderGain(1)).toBe(1);
    expect(sliderGain(0.5)).toBeCloseTo(0.25);
    expect(sliderGain(2)).toBe(1);
    expect(busGain({ ...AUDIO_DEFAULTS, effects: 0.5 }, 'effects')).toBeCloseTo(0.25);
  });

  it('text speed is remembered, and instant writes everything at once', () => {
    const store = memory();
    expect(loadTextSpeed(store)).toBe('normal');
    saveTextSpeed(store, 'fast');
    expect(loadTextSpeed(store)).toBe('fast');
    expect(loadTextSpeed(memory({ 'stl:text-speed': 'ludicrous' }))).toBe('normal');
    expect(textSpeedFactor('slow')).toBeLessThan(textSpeedFactor('normal'));
    expect(textSpeedFactor('instant')).toBe(Infinity);
  });
});

describe('voice limiter', () => {
  it('lets one copy through at full level, quiets a repeat within the window and drops a third', () => {
    const v = new VoiceLimiter(3, 40);
    expect(v.admit('cannon-x', 0, 2000)).toBe(1);
    expect(v.admit('cannon-x', 10, 2000)).toBe(0.5);
    expect(v.admit('cannon-x', 20, 2000)).toBe(0);
    // Out of the window, another may sound.
    expect(v.admit('cannon-x', 100, 2000)).toBe(1);
    // Other names are counted on their own.
    expect(v.admit('splash', 100, 500)).toBe(1);
  });

  it('caps how many copies sound at once, and frees a voice when it ends', () => {
    const v = new VoiceLimiter(3, 40, {});
    for (const t of [0, 100, 200]) expect(v.admit('fire', t, 1000)).toBe(1);
    expect(v.admit('fire', 300, 1000)).toBe(0);
    expect(v.count('fire', 300)).toBe(3);
    expect(v.admit('fire', 1050, 1000)).toBe(1);
    // Per-name caps.
    const capped = new VoiceLimiter(3, 40, { hover: 1 });
    expect(capped.admit('hover', 0, 100)).toBe(1);
    expect(capped.admit('hover', 60, 100)).toBe(0);
  });
});

describe('battle tension', () => {
  const fresh: TensionInput = { hull: 1, enemyHull: 1, crew: 1, boarders: 0, fires: 0, flood: 0 };

  it('a fresh fight is calm; a beaten ship is desperate; winning comfortably stays calm', () => {
    expect(battleTension(fresh)).toBeLessThan(0.1);
    expect(battleTension({ ...fresh, hull: 0.25, enemyHull: 0.8, crew: 0.6 })).toBeGreaterThan(0.6);
    expect(battleTension({ ...fresh, hull: 0.9, enemyHull: 0.15 })).toBeLessThan(0.32);
  });

  it('a close finish, boarders, fire and flooding all raise it', () => {
    const base = battleTension({ ...fresh, hull: 0.6, enemyHull: 0.6 });
    expect(battleTension({ ...fresh, hull: 0.35, enemyHull: 0.3 })).toBeGreaterThan(0.5);
    for (const worse of [{ boarders: 3 }, { fires: 2 }, { flood: 0.2 }, { grappled: true }, { crew: 0.5 }]) {
      expect(battleTension({ ...fresh, hull: 0.6, enemyHull: 0.6, ...worse }), JSON.stringify(worse)).toBeGreaterThan(base);
    }
  });

  it('rises as our hull falls, and stays within 0..1 whatever it is fed', () => {
    let last = -1;
    for (let h = 1; h >= 0; h -= 0.1) {
      const t = battleTension({ ...fresh, hull: h, enemyHull: 0.7 });
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
    const wild = battleTension({ hull: -5, enemyHull: 9, crew: NaN, boarders: 99, fires: 50, flood: 3, grappled: true });
    expect(wild).toBeGreaterThanOrEqual(0);
    expect(wild).toBeLessThanOrEqual(1);
  });
});

describe('tension gauge', () => {
  const run = (g: TensionGauge, raw: number, seconds: number, dt = 0.1): boolean => {
    let hot = g.hot;
    for (let t = 0; t < seconds; t += dt) hot = g.update(raw, dt);
    return hot;
  };

  it('turns hot soon after the fight does, and calm again only well after it eases', () => {
    const g = new TensionGauge();
    expect(run(g, 0.1, 5)).toBe(false);
    expect(run(g, 0.9, 3)).toBe(true);
    // Eased a little, but not below the exit line: still hot.
    expect(run(g, 0.4, 30)).toBe(true);
    expect(run(g, 0.05, 30)).toBe(false);
  });

  it('does not flap when the fight hovers about the line', () => {
    const g = new TensionGauge();
    let switches = 0;
    let was = g.hot;
    for (let i = 0; i < 600; i++) {
      const hot = g.update(i % 20 < 10 ? 0.62 : 0.38, 0.1);
      if (hot !== was) switches++;
      was = hot;
    }
    expect(switches).toBeLessThanOrEqual(1);
  });

  it('holds a switch for its dwell time, and resets cold', () => {
    const g = new TensionGauge(0.5, 0.32, 8);
    run(g, 1, 3);
    expect(g.hot).toBe(true);
    // Calm at once, but the music holds for the dwell.
    expect(run(g, 0, 4)).toBe(true);
    expect(run(g, 0, 10)).toBe(false);
    g.reset();
    expect(g.hot).toBe(false);
    expect(g.level).toBe(0);
  });
});

describe('what plays where', () => {
  it('each screen has its bed, with the old shanty behind the new title and hideout themes', () => {
    expect(musicChoices('Title', mood())).toEqual(['music-title', 'shanty']);
    expect(musicChoices('Harbour', mood())).toEqual(['music-harbour', 'shanty']);
    expect(musicChoices('SeaMap', mood())).toEqual(['music-sea']);
    expect(musicChoices('SeaMap', mood({ tense: true }))[0]).toBe('music-sea-tense');
    expect(musicChoices('Port', mood())[0]).toBe('music-port');
    expect(musicChoices('Port', mood({ tavern: true }))[0]).toBe('music-tavern');
    expect(musicChoices('Battle', mood())).toEqual(['music-battle']);
    expect(musicChoices('Battle', mood(), true)[0]).toBe('music-battle-hot');
    expect(musicChoices('Battle', mood({ boss: true }), false)[0]).toBe('music-boss');
    expect(musicChoices('Options', mood())).toEqual([]);
  });

  it('plays the best bed that is ready while fetching the best one there is, and skips any that are missing', () => {
    const listed = new Set(['music-battle', 'music-battle-hot', 'shanty']);
    const loaded = new Set(['music-battle', 'shanty']);
    const usable = (n: string) => listed.has(n);
    const ready = (n: string) => loaded.has(n);
    expect(pickTrack(['music-battle-hot', 'music-battle'], usable, ready)).toEqual({ play: 'music-battle', fetch: 'music-battle-hot' });
    expect(pickTrack(['music-battle'], usable, ready)).toEqual({ play: 'music-battle', fetch: null });
    // The new title theme is not in the manifest (or failed to load): the shanty, nothing to fetch.
    expect(pickTrack(['music-title', 'shanty'], usable, ready)).toEqual({ play: 'shanty', fetch: null });
    expect(pickTrack(['music-boss'], usable, ready)).toEqual({ play: null, fetch: null });
  });

  it('layers ambience by screen and mood', () => {
    expect(ambienceFor('Battle', mood())['amb-fire']).toBe(0);
    expect(ambienceFor('Battle', mood({ fire: 1 }))['amb-fire']).toBeGreaterThan(0.4);
    expect(ambienceFor('Port', mood({ tavern: true }))['amb-tavern']).toBeGreaterThan(ambienceFor('Port', mood({ tavern: true }))['amb-harbour']);
    expect(ambienceFor('Port', mood())['amb-tavern']).toBeUndefined();
    const calm = ambienceFor('SeaMap', mood({ wind: 0, storm: 0 }));
    const storm = ambienceFor('SeaMap', mood({ wind: 1, storm: 1 }));
    expect(storm['amb-wind']).toBeGreaterThan(calm['amb-wind']);
    expect(storm['amb-storm']).toBeGreaterThan(0.5);
    expect(calm['amb-storm']).toBe(0);
    expect(ambienceFor('Harbour', mood())['amb-harbour']).toBeGreaterThan(0);
    for (const level of Object.values(ambienceFor('Battle', mood({ wind: 5, storm: 5, fire: 5 })))) expect(level).toBeLessThanOrEqual(1);
  });

  it('pans our side left and hers right, never hard over', () => {
    expect(panFor(640)).toBe(0);
    expect(panFor(250)).toBeLessThan(0);
    expect(panFor(1000)).toBeGreaterThan(0);
    expect(panFor(-5000)).toBe(-0.6);
    expect(panFor(5000)).toBe(0.6);
    expect(panFor(NaN)).toBe(0);
  });
});
