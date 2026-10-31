import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLoadout, arrivals, COLOURS, LOADOUTS, loadoutsFor, milestonesAt, MILESTONES, nextMilestone } from '../../src/data/hideout';
import { PLAYER_SHIPS } from '../../src/data/ships';
import { weapon } from '../../src/data/weapons';
import { autoRun } from '../../src/sim/autoRun';
import { MAX_GUNS, Run } from '../../src/sim/Run';

type SaveModule = typeof import('../../src/scenes/save');

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

const PROFILE = 'slower-than-light.profile.v1';
const TAVERN = 'slower-than-light.tavern.v1';
let storage: MemoryStorage;
let save: SaveModule;

beforeEach(async () => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  save = await import('../../src/scenes/save');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A whole voyage, sailed by the AI. */
const voyage = (shipId = 'gull', seed = 3) => autoRun(new Run(shipId, seed), { focus: 'guns' }).run;

describe('the hideout grows with renown', () => {
  it('reaches its milestones in order, each once', () => {
    expect(milestonesAt(0)).toEqual([]);
    const renowns = MILESTONES.map((m) => m.renown);
    expect([...renowns].sort((a, b) => a - b)).toEqual(renowns);
    expect(milestonesAt(1e6)).toHaveLength(MILESTONES.length);
    expect(milestonesAt(MILESTONES[1].renown).map((m) => m.id)).toEqual([MILESTONES[0].id, MILESTONES[1].id]);
  });

  it('says what arrives between two totals, and what comes next', () => {
    const a = arrivals(0, 55);
    expect(a.milestones.map((m) => m.id)).toEqual(['lanterns', 'jetty']);
    expect(a.colours.map((c) => c.id)).toEqual(['cutlasses']);
    expect(a.loadouts.map((l) => l.id)).toEqual(['wren-chaser']);
    expect(arrivals(55, 55)).toEqual({ milestones: [], colours: [], loadouts: [] });
    expect(nextMilestone(0)).toEqual({ name: 'Lanterns on the quay', renown: 20 });
    expect(nextMilestone(1e6)).toBeNull();
  });

  it('starts every captain with the Jolly Roger free', () => {
    expect(COLOURS.filter((c) => c.renown === 0).map((c) => c.id)).toEqual(['pirate']);
  });
});

describe('alternate batteries', () => {
  it('are side-grades: same ship, within her gun ports, nothing she cannot crew', () => {
    for (const l of LOADOUTS) {
      const def = PLAYER_SHIPS.find((s) => s.id === l.ship)!;
      expect(def, l.id).toBeDefined();
      expect(l.guns.length).toBeLessThanOrEqual(MAX_GUNS);
      expect(l.guns.length).toBe(def.guns.length);
      for (const g of l.guns) weapon(g.weapon);
      const run = new Run(l.ship, 1);
      expect(applyLoadout(run, l.id)).toBe(true);
      expect(run.fit.guns.map((g) => g.weapon)).toEqual(l.guns.map((g) => g.weapon));
      expect(run.fit.systems.guns).toBeGreaterThanOrEqual(l.guns.reduce((n, g) => n + weapon(g.weapon).hands, 0));
    }
  });

  it('are offered only for their own ship, once the renown is earned', () => {
    expect(loadoutsFor('gull', 0)).toEqual([]);
    expect(loadoutsFor('gull', 1e6).map((l) => l.id)).toEqual(['gull-smasher']);
    const run = new Run('wren', 1);
    const guns = run.fit.guns.map((g) => g.weapon);
    expect(applyLoadout(run, 'gull-smasher')).toBe(false);
    expect(applyLoadout(run, null)).toBe(false);
    expect(applyLoadout(run, 'no-such')).toBe(false);
    expect(run.fit.guns.map((g) => g.weapon)).toEqual(guns);
  });

  it('survive a save and load', () => {
    const run = new Run('maw', 9);
    applyLoadout(run, 'maw-mortar');
    const back = Run.fromSave(JSON.parse(JSON.stringify(run.toSave())));
    expect(back.fit.guns.map((g) => g.weapon)).toEqual(['pdr12', 'pdr12', 'mortar', 'pdr6']);
  });

  it('sail a whole voyage', () => {
    for (const l of LOADOUTS) {
      const run = new Run(l.ship, 5);
      applyLoadout(run, l.id);
      expect(autoRun(run).run.over).toBe(true);
    }
  });
});

describe('the profile', () => {
  it('reads an old profile without the hideout fields', () => {
    storage.setItem(PROFILE, JSON.stringify({ voyages: 4, wins: 1, captures: 2, renown: 75, counted: [1, 2] }));
    const p = save.profile();
    expect(p).toMatchObject({ voyages: 4, wins: 1, captures: 2, renown: 75, counted: [1, 2], allies: [], loadouts: {} });
    expect(p.colours).toBeUndefined();
    expect(save.chosenColours()).toBe('pirate');
    expect(save.chosenLoadout('gull')).toBeNull();
  });

  it('shrugs off junk in the new fields', () => {
    storage.setItem(PROFILE, JSON.stringify({ renown: 500, allies: ['spain', 7, 'atlantis'], colours: 3, loadouts: { gull: 9, maw: 'maw-mortar' } }));
    const p = save.profile();
    expect(p.allies).toEqual(['spain']);
    expect(p.colours).toBeUndefined();
    expect(p.loadouts).toEqual({ maw: 'maw-mortar' });
  });

  it('keeps the hideout choices through other profile writes', () => {
    storage.setItem(PROFILE, JSON.stringify({ renown: 200 }));
    save.setColours('hourglass');
    save.setLoadout('gull', 'gull-smasher');
    save.bumpProfile('voyages');
    expect(save.chosenColours()).toBe('hourglass');
    expect(save.chosenLoadout('gull')).toBe('gull-smasher');
    expect(save.profile().voyages).toBe(1);
    save.setLoadout('gull', null);
    expect(save.chosenLoadout('gull')).toBeNull();
  });

  it('flies only colours and batteries whose renown is earned', () => {
    storage.setItem(PROFILE, JSON.stringify({ renown: 10, colours: 'hourglass', loadouts: { maw: 'maw-mortar' } }));
    expect(save.chosenColours()).toBe('pirate');
    expect(save.chosenLoadout('maw')).toBeNull();
  });

  it('counts a voyage once, with the renown before and after', () => {
    storage.setItem(PROFILE, JSON.stringify({ renown: 25 }));
    const run = voyage();
    const first = save.awardRenown(run);
    expect(first).toMatchObject({ earned: run.renown, before: 25, total: 25 + run.renown });
    const again = save.awardRenown(run);
    expect(again).toMatchObject({ before: first.total, total: first.total });
    expect(again.unlocked).toEqual([]);
  });

  it('remembers the powers a voyage ended allied with', () => {
    const run = voyage();
    run.standing.france = 100;
    run.standing.spain = -100;
    save.awardRenown(run);
    expect(save.profile().allies).toContain('france');
    expect(save.profile().allies).not.toContain('spain');
  });
});

describe('the tavern wall', () => {
  it('hangs each voyage once, newest last, and keeps only the most recent', () => {
    expect(save.paintings()).toEqual([]);
    const run = voyage('wren', 4);
    const p = save.hangPainting(run, 12)!;
    expect(p).toMatchObject({ seed: run.seed, ship: 'wren', captain: 'rover', renown: 12, sailed: run.legs.sailed, total: run.legs.total });
    expect(p.highlight.length).toBeGreaterThan(0);
    expect(save.hangPainting(run, 99)).toEqual(p);
    expect(save.paintings()).toHaveLength(1);
    for (let seed = 100; seed < 100 + save.TAVERN_PAINTINGS + 3; seed++) {
      const r = new Run('gull', seed);
      r.status = 'lost';
      save.hangPainting(r, seed);
    }
    const wall = save.paintings();
    expect(wall).toHaveLength(save.TAVERN_PAINTINGS);
    expect(wall.at(-1)!.seed).toBe(100 + save.TAVERN_PAINTINGS + 2);
  });

  it('leaves off anything malformed, and survives a corrupt wall', () => {
    storage.setItem(TAVERN, JSON.stringify([{ seed: 1, ship: 'gull', captain: 'rover', renown: 3 }, { seed: 'x' }, null, 4]));
    expect(save.paintings().map((p) => p.seed)).toEqual([1]);
    storage.setItem(TAVERN, '{not json');
    expect(save.paintings()).toEqual([]);
    storage.setItem(TAVERN, '{"a":1}');
    expect(save.paintings()).toEqual([]);
  });

  it('hangs nothing from a dev sandbox', () => {
    save.disableSaving();
    expect(save.hangPainting(voyage(), 5)).toBeNull();
    expect(storage.getItem(TAVERN)).toBeNull();
  });
});
