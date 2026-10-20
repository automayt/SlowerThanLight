import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_SHIPS } from '../../src/data/ships';
import { autoRun, autoStep, MAX_DECISIONS, type AutoRunResult } from '../../src/sim/autoRun';
import { DIFFICULTY, Run, type Difficulty, type RunSave } from '../../src/sim/Run';

type SaveModule = typeof import('../../src/scenes/save');

const KEY = 'slower-than-light.voyage.v1';

/** A Map-backed stand-in for the browser's localStorage. */
class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, String(v));
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

let storage: MemoryStorage;
let save: SaveModule;

beforeEach(async () => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  // A fresh module each time: disableSaving() is one-way for the page's lifetime.
  vi.resetModules();
  save = await import('../../src/scenes/save');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** What a browser would hand back: the save after a trip through JSON. */
const viaJson = (run: Run): RunSave => JSON.parse(JSON.stringify(run.toSave()));

/** A run that has sailed a few legs, so its save has a chart, history and wear on it. */
function sailed(shipId = 'gull', seed = 3, decisions = 6): Run {
  const run = new Run(shipId, seed);
  for (let i = 0; i < decisions && !run.over; i++) autoStep(run);
  return run;
}

/** Write a hand-edited save, then load it back. */
function loadEdited(edit: (s: RunSave) => void): Run | null {
  const s = viaJson(sailed());
  edit(s);
  storage.setItem(KEY, JSON.stringify(s));
  return save.loadRun();
}

describe('resuming a voyage', () => {
  // Every decision of a few whole voyages: the save restores the same state, and a voyage resumed from any
  // checkpoint plays out exactly as the uninterrupted one did, battle for battle.
  const cases: [string, number, Difficulty][] = [
    ['wren', 11, 'easy'],
    ['gull', 12, 'normal'],
    ['maw', 13, 'hard'],
    ['wolf', 14, 'normal'],
  ];
  for (const [shipId, seed, difficulty] of cases) {
    it(`${shipId} seed ${seed} (${difficulty}): from any save point the voyage carries on exactly as before`, () => {
      const run = new Run(shipId, seed, difficulty);
      const battles: AutoRunResult['battles'] = [];
      const checkpoints: { save: RunSave; battlesSoFar: number }[] = [];
      for (let d = 0; d < MAX_DECISIONS && !run.over; d++) {
        const snapshot = viaJson(run);
        expect(Run.fromSave(snapshot).toSave(), `decision ${d}`).toEqual(run.toSave());
        if (d % 4 === 0) checkpoints.push({ save: snapshot, battlesSoFar: battles.length });
        autoStep(run, {}, battles);
      }
      expect(run.over).toBe(true);
      const final = run.toSave();
      for (const cp of checkpoints) {
        const resumed = autoRun(Run.fromSave(cp.save));
        expect(resumed.run.toSave()).toEqual(final);
        expect(resumed.battles).toEqual(battles.slice(cp.battlesSoFar));
      }
    });
  }

  it('a battle reloaded before the first shot is the same battle (no rerolling a bad fight)', () => {
    const run = sailed('maw', 8, 0);
    for (let i = 0; run.status !== 'battle' && i < 40; i++) autoStep(run);
    expect(run.status).toBe('battle');
    save.saveRun(run);
    const reloaded = save.loadRun()!;
    const fight = (r: Run) => {
      const b = r.startBattle({ autoPlayer: true });
      b.runToEnd(900);
      return [b.outcome?.kind, b.time, b.player.hull, b.enemy.hull, b.stats];
    };
    expect(fight(reloaded)).toEqual(fight(run));
  });
});

describe('saveRun and loadRun', () => {
  it('round-trip a voyage through storage', () => {
    const run = sailed();
    save.saveRun(run);
    expect(save.loadRun()!.toSave()).toEqual(run.toSave());
  });

  it('a finished voyage is forgotten, and there is nothing to continue', () => {
    const run = sailed();
    save.saveRun(run);
    run.concede('Sunk in a test.');
    save.saveRun(run);
    expect(storage.getItem(KEY)).toBeNull();
    expect(save.loadRun()).toBeNull();
  });

  it('nothing saved means nothing to load', () => {
    expect(save.loadRun()).toBeNull();
  });

  it('clearSave forgets the voyage', () => {
    save.saveRun(sailed());
    save.clearSave();
    expect(save.loadRun()).toBeNull();
  });

  it('a sandbox that disabled saving never touches the real voyage, logbook or profile', () => {
    const run = sailed();
    save.saveRun(run);
    const before = storage.getItem(KEY);
    save.disableSaving();
    save.saveRun(sailed('wren', 9));
    save.clearSave();
    save.recordDiscovery('storm');
    save.bumpProfile('wins');
    expect(storage.getItem(KEY)).toBe(before);
    expect(save.discovered().size).toBe(0);
    expect(save.profile().wins).toBe(0);
  });

  it('works without storage at all (private windows, blocked site data)', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    vi.stubGlobal('localStorage', broken);
    expect(() => save.saveRun(sailed())).not.toThrow();
    expect(save.loadRun()).toBeNull();
    expect(() => save.clearSave()).not.toThrow();
    expect(save.discovered().size).toBe(0);
    expect(() => save.recordDiscovery('storm')).not.toThrow();
    expect(save.profile()).toEqual({ voyages: 0, wins: 0, captures: 0 });
    expect(() => save.bumpProfile('voyages')).not.toThrow();
  });
});

describe('corrupt and outdated saves', () => {
  const rejected: [string, (s: RunSave) => void][] = [
    ['an unknown version', (s) => ((s as { version: number }).version = 2)],
    ['an unknown ship', (s) => (s.shipId = 'flying-dutchman')],
    ['a node off the chart', (s) => (s.nodeId = 999)],
    ['a battle with an enemy that no longer exists', (s) => ((s.status = 'battle'), (s.encounter = { kind: 'battle', enemy: 'kraken', name: 'X', boss: false, ambush: false, text: '' }))],
    ['an event that no longer exists', (s) => ((s.status = 'event'), (s.encounter = { kind: 'event', event: 'no-such-event' }))],
    ['a prize gun that no longer exists', (s) => (s.prize = { guns: ['harpoon-gun'], recruits: 0, taken: false })],
    ['a mounted gun that no longer exists', (s) => (s.fit.guns[0].weapon = 'harpoon-gun')],
    ['a chart node holding an enemy that no longer exists', (s) => (s.chart.nodes.find((n) => n.col > 0)!.enemy = 'kraken')],
    ['a port armoury stocking a gun that no longer exists', (s) => (s.chart.nodes.find((n) => n.col > 0)!.stock = ['harpoon-gun'])],
    ['a port visit selling a gun that no longer exists', (s) => ((s.status = 'port'), (s.encounter = { kind: 'port', name: 'Nassau', rested: false, stock: ['harpoon-gun'] }))],
    ['a port visit selling a fitting that no longer exists', (s) => ((s.status = 'port'), (s.encounter = { kind: 'port', name: 'Nassau', rested: false, stock: [], fittings: ['mermaid-bait'] }))],
    ['a fitting aboard that no longer exists', (s) => (s.fittings = ['mermaid-bait'])],
    ['an unknown status', (s) => ((s as { status: string }).status = 'drydock')],
    ['gold that is not a number', (s) => ((s as { gold: unknown }).gold = 'lots')],
    ['a crew member with no health', (s) => ((s.condition.crew[0] as { hp: unknown }).hp = null)],
    ['no chart', (s) => delete (s as Partial<RunSave>).chart],
    ['a bare object', (s) => Object.keys(s).forEach((k) => k !== 'version' && delete (s as unknown as Record<string, unknown>)[k])],
  ];
  it('a save that is not JSON is rejected and cleared', () => {
    storage.setItem(KEY, '{"version":1,');
    expect(save.loadRun()).toBeNull();
    expect(storage.getItem(KEY)).toBeNull();
  });

  for (const [what, edit] of rejected) {
    it(`a save with ${what} is rejected and cleared, not loaded into a game that would crash`, () => {
      expect(loadEdited(edit)).toBeNull();
      expect(storage.getItem(KEY)).toBeNull();
    });
  }

  it('a save from before sectors, provisions, fittings, difficulty, flags and prizes loads with sensible defaults', () => {
    const run = loadEdited((s) => {
      for (const k of ['endingTitle', 'difficulty', 'flags', 'seenEvents', 'prize', 'sector', 'provisions', 'fittings'] as const) delete s[k];
      delete s.fit.systems.bulwarks;
    })!;
    expect(run).not.toBeNull();
    expect(run.difficulty).toBe('normal');
    expect(run.provisions).toBe(DIFFICULTY.normal.provisions);
    expect(run.fittings).toEqual([]);
    expect(run.flags.size).toBe(0);
    expect(run.prize).toBeNull();
    expect(run.sector).toBe(0);
    expect(run.fit.systems.bulwarks).toBe(run.def.systems.bulwarks);
    // And it plays on to an ending.
    expect(autoRun(run).run.over).toBe(true);
  });

  it('every ship and difficulty saves and loads at the start of a voyage', () => {
    for (const def of PLAYER_SHIPS) {
      for (const d of Object.keys(DIFFICULTY) as Difficulty[]) {
        const run = new Run(def.id, 4, d);
        save.saveRun(run);
        expect(save.loadRun()?.toSave(), `${def.id} ${d}`).toEqual(run.toSave());
      }
    }
  });
});

describe('logbook and profile', () => {
  it('records each event once', () => {
    save.recordDiscovery('storm');
    save.recordDiscovery('storm');
    save.recordDiscovery('kraken');
    expect([...save.discovered()].sort()).toEqual(['kraken', 'storm']);
  });

  it('a damaged logbook reads as empty or keeps only what makes sense', () => {
    storage.setItem('slower-than-light.logbook.v1', 'not json');
    expect(save.discovered().size).toBe(0);
    storage.setItem('slower-than-light.logbook.v1', '{"storm":true}');
    expect(save.discovered().size).toBe(0);
    storage.setItem('slower-than-light.logbook.v1', '["storm", 3, null, "fog"]');
    expect([...save.discovered()]).toEqual(['storm', 'fog']);
  });

  it('counts voyages, wins and captures, and shrugs off a damaged profile', () => {
    save.bumpProfile('voyages');
    save.bumpProfile('voyages');
    save.bumpProfile('captures');
    expect(save.profile()).toEqual({ voyages: 2, wins: 0, captures: 1 });
    storage.setItem('slower-than-light.profile.v1', '{"voyages":"many","wins":-0,"captures":null}');
    expect(save.profile()).toEqual({ voyages: 0, wins: 0, captures: 0 });
    storage.setItem('slower-than-light.profile.v1', '[[[');
    expect(save.profile()).toEqual({ voyages: 0, wins: 0, captures: 0 });
  });
});

describe('sceneFor', () => {
  it('resumes each kind of encounter in its own scene', () => {
    const run = new Run('gull', 1);
    const scenes = (['chart', 'battle', 'event', 'port', 'won', 'lost'] as const).map((s) => ((run.status = s), save.sceneFor(run)));
    expect(scenes).toEqual(['SeaMap', 'Battle', 'Event', 'Port', 'RunEnd', 'RunEnd']);
  });
});
