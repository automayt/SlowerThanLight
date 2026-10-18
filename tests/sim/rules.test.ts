import { describe, expect, it } from 'vitest';
import { RECRUIT_NAMES, SEA_EVENTS } from '../../src/data/voyage';
import { DESERT_CHANCE, JUMP_HEAL, MAX_GUNS, Run, STARVE_HP, SYSTEM_CAP } from '../../src/sim/Run';
import { generateChart } from '../../src/sim/SeaChart';
import { Rng } from '../../src/sim/rng';
import type { EventEffect, EventNeeds, SeaEventDef } from '../../src/sim/types';

const PROBE: SeaEventDef = { id: 'probe', title: 'Probe', text: '{crew} and {crew2}', choices: [{ label: 'Go', outcomes: [{ weight: 1, effect: { text: 'ok' } }] }] };

/** A run mid-event (a made-up one), so effects can name {crew} and {crew2}. */
function inEvent(seed = 1): Run {
  const run = new Run('gull', seed);
  run.startEvent(PROBE);
  return run;
}

const apply = (run: Run, effect: Omit<EventEffect, 'text'>) => run.applyEffect({ text: '', ...effect });

/** Sail one leg with the fleet held well back, so the jump is never an ambush. */
function sail(run: Run): void {
  run.navy = -99;
  run.status = 'chart';
  run.jump(run.reachable()[0].id);
}

describe('event conditions', () => {
  // Each condition, on a run that fails it and then on one that meets it.
  const cases: [string, EventNeeds, (r: Run) => void, string][] = [
    ['crew', { crew: 9 }, (r) => r.condition.crew.push(...['A', 'B', 'C', 'D'].map((name) => ({ name, hp: 100, home: '' }))), 'needs 9 crew'],
    ['gold', { gold: 500 }, (r) => (r.gold = 500), 'needs 500 gold'],
    ['hurt', { hurt: true }, (r) => (r.condition.crew[0].hp = 69), 'nobody is hurt'],
    ['damaged', { damaged: true }, (r) => (r.condition.damage.helm = 1), 'nothing is damaged'],
    ['battered', { battered: true }, (r) => (r.condition.hull = Math.floor((r.fit.hull - 1) / 2)), 'hull is sound'],
    ['flag', { flag: 'cat' }, (r) => r.flags.add('cat'), 'no ship’s cat'],
    ['unknown flag', { flag: 'mystery' }, (r) => r.flags.add('mystery'), 'you lack something'],
    ['noFlag', { noFlag: 'cursed' }, (r) => r.flags.delete('cursed'), 'already done'],
    ['gunPort', { gunPort: true }, (r) => r.fit.guns.splice(MAX_GUNS - 1), 'no free gun port'],
    ['provisions', { provisions: 15 }, (r) => (r.provisions = 15), 'needs 15 provisions'],
    ['minSector', { minSector: 1 }, (r) => (r.sector = 1), 'too early'],
    // Columns are on the voyage-wide 0..7 scale: the fourth column of the first sector is column 1 of 7.
    ['minCol', { minCol: 1 }, (r) => (r.nodeId = r.chart.nodes.find((n) => n.col === 3)!.id), 'too early'],
    ['maxCol', { maxCol: 0 }, (r) => (r.nodeId = 0), 'too late'],
  ];
  for (const [name, needs, meet, why] of cases) {
    it(`${name}: says why when unmet, and passes when met`, () => {
      const run = new Run('gull', 2);
      run.flags.add('cursed');
      while (run.fit.guns.length < MAX_GUNS) run.fit.guns.push({ weapon: 'pdr6' });
      if (name === 'maxCol') run.nodeId = run.chart.nodes.find((n) => n.col === 3)!.id;
      expect(run.unmet(needs)).toBe(why);
      meet(run);
      expect(run.unmet(needs)).toBeNull();
    });
  }

  it('a choice that does not exist, or costs more than you have, is blocked', () => {
    const run = new Run('gull', 1);
    const paid = SEA_EVENTS.find((e) => e.choices.some((c) => (c.cost ?? 0) > 0 && !c.needs))!;
    run.startEvent(paid);
    expect(run.choiceBlocker(99)).toBe('no such choice');
    expect(() => run.chooseEvent(99)).toThrow('not available');
    run.gold = 0;
    const i = paid.choices.findIndex((c) => (c.cost ?? 0) > 0 && !c.needs);
    expect(run.choiceBlocker(i)).toBe(`needs ${paid.choices[i].cost} gold`);
  });

  it('there is no event to answer or enemy to fight outside one', () => {
    const run = new Run('gull', 1);
    expect(() => run.chooseEvent(0)).toThrow('No event');
    expect(() => run.currentEvent()).toThrow('No event');
    expect(() => run.currentEnemy()).toThrow('No battle');
    expect(() => run.startBattle()).toThrow('No battle');
    expect(() => run.eventText()).toThrow('No event');
    expect(run.fill('{crew} on {ship}')).toBe('a sailor on The Black Gull');
  });
});

describe('event effects', () => {
  it('a free upgrade of something already at its cap pays 20 gold instead', () => {
    const run = inEvent();
    run.fit.systems.helm = SYSTEM_CAP.helm;
    const gold = run.gold;
    expect(apply(run, { upgrade: 'helm' })).toEqual(['+20 gold']);
    expect(run.gold).toBe(gold + 20);
    expect(apply(run, { upgrade: 'sails' })[0]).toContain('Sails');
    expect(run.fit.systems.sails).toBe(run.def.systems.sails! + 1);
  });

  it('damage stops at what a system has, and nothing happens to a system she lacks or for no damage', () => {
    const run = inEvent();
    run.fit.systems = { ...run.fit.systems, surgeon: 0 };
    expect(apply(run, { damage: { sails: 99, surgeon: 2, helm: 0 } })).toEqual(['Sails damaged']);
    expect(run.condition.damage).toEqual({ sails: run.fit.systems.sails });
  });

  it('losses of gold stop at an empty purse and report what was really lost', () => {
    const run = inEvent();
    run.gold = 7;
    expect(apply(run, { gold: -50 })).toEqual(['−7 gold']);
    expect(run.gold).toBe(0);
  });

  it('hull and wounds never sink the ship or kill anyone; a full hull reports nothing', () => {
    const run = inEvent();
    expect(apply(run, { hull: 5 })).toEqual([]);
    apply(run, { hull: -999, crewHp: -999, actorHp: -999 });
    expect(run.condition.hull).toBe(1);
    expect(run.condition.crew.every((c) => c.hp === 1)).toBe(true);
    apply(run, { crewHp: 999 });
    expect(run.condition.crew.every((c) => c.hp === 100)).toBe(true);
  });

  it('repairs report only when something was broken', () => {
    const run = inEvent();
    expect(apply(run, { repair: true })).toEqual([]);
    run.condition.damage.guns = 2;
    expect(apply(run, { repair: true })).toEqual(['Systems repaired']);
    expect(run.condition.damage).toEqual({});
  });

  it('recruits need bunks; a named hand signs on by name', () => {
    const run = inEvent();
    const out = apply(run, { recruitName: 'Long Ben', recruit: 5 });
    expect(out[0]).toBe('Long Ben joins the crew');
    expect(run.condition.crew).toHaveLength(run.maxCrew);
    expect(out.at(-1)).toBe('No bunk to spare: they stay ashore');
    expect(run.condition.crew.filter((c) => RECRUIT_NAMES.includes(c.name))).toHaveLength(run.maxCrew - run.def.crew.length - 1);
  });

  it('losing crew never takes the last hand', () => {
    const run = inEvent();
    expect(apply(run, { loseCrew: 99 })).toHaveLength(run.def.crew.length - 1);
    expect(run.condition.crew).toHaveLength(1);
    apply(run, { loseActor: true, loseActor2: true });
    expect(run.condition.crew).toHaveLength(1);
  });

  it('a gun with no free port is sold for scrap; flags come and go; the fleet moves', () => {
    const run = inEvent();
    while (run.fit.guns.length < MAX_GUNS) run.fit.guns.push({ weapon: 'pdr6' });
    const gold = run.gold;
    expect(apply(run, { gun: 'pdr18' })[0]).toMatch(/fetches 37 gold/);
    expect(run.gold).toBe(gold + 37);
    apply(run, { flag: 'cursed' });
    expect(run.flags.has('cursed')).toBe(true);
    apply(run, { clearFlag: 'cursed' });
    expect(run.flags.has('cursed')).toBe(false);
    const navy = run.navy;
    expect(apply(run, { navy: -1 })).toEqual(['You gain on the Navy']);
    expect(run.navy).toBe(navy - 1);
  });

  it('a full hold turns away more provisions and says so', () => {
    const run = inEvent();
    run.provisions = run.maxProvisions;
    expect(apply(run, { provisions: 3 })).toEqual(['No room in the hold']);
    expect(apply(run, { provisions: -1 })).toEqual(['−1 provision']);
  });
});

describe('fittings at work', () => {
  it('spare spars mend two damaged systems a jump instead of one', () => {
    const run = new Run('gull', 2);
    run.condition.damage = { guns: 2, sails: 1, helm: 1 };
    run.fittings.push('spars');
    sail(run);
    expect(Object.values(run.condition.damage).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("a surgeon's chest doubles healing on a full belly", () => {
    const run = new Run('gull', 2);
    run.fittings.push('chest');
    run.condition.crew[0].hp = 40;
    sail(run);
    expect(run.condition.crew[0].hp).toBe(40 + 2 * JUMP_HEAL);
  });

  it('gun drill and boarding nets go into battle with you', () => {
    const run = new Run('gull', 2);
    run.status = 'battle';
    run.encounter = { kind: 'battle', enemy: 'cutter', name: 'HMS Test', boss: false, ambush: false, text: '' };
    const plain = run.startBattle();
    expect([plain.player.reloadRate, plain.player.boardingNets]).toEqual([1, false]);
    run.fittings.push('drill', 'nets');
    const fitted = run.startBattle();
    expect([fitted.player.reloadRate, fitted.player.boardingNets]).toEqual([1.1, true]);
  });
});

describe('short rations', () => {
  it('the last hand never deserts, and nobody starves to death', () => {
    const run = new Run('gull', 6);
    run.condition.crew.splice(1);
    run.provisions = 0;
    for (let i = 0; i < 4; i++) {
      sail(run);
      run.provisions = 0;
    }
    expect(run.condition.crew).toHaveLength(1);
    expect(run.condition.crew[0].hp).toBe(1);
  });

  it('someone slips away on about the stated share of hungry nights', () => {
    let deserted = 0;
    const tries = 200;
    for (let seed = 0; seed < tries; seed++) {
      const run = calm(new Run('maw', seed));
      run.provisions = 0;
      const before = run.condition.crew.length;
      sail(run);
      if (run.condition.crew.length < before) deserted++;
      expect(run.hungerNote).toContain(`−${STARVE_HP} HP`);
    }
    expect(deserted / tries).toBeGreaterThan(DESERT_CHANCE - 0.1);
    expect(deserted / tries).toBeLessThan(DESERT_CHANCE + 0.1);
  });
});

describe('guard rails', () => {
  it('nothing to buy or sell away from port', () => {
    const run = new Run('gull', 1);
    run.gold = 999;
    expect(run.gunOffers()).toEqual([]);
    expect(run.fittingOffers()).toEqual([]);
    expect(run.buyGun('pdr6')).toBe(false);
    expect(run.buyFitting('drill')).toBe(false);
    expect(run.buyUpgrade('guns')).toBe(false);
    expect(run.buyProvisions()).toBe(false);
    expect(run.sellGun(0)).toBe(false);
    expect(run.rest()).toBe(false);
    expect(run.hireCrew()).toBeNull();
    expect(run.repairHull()).toBe(false);
  });

  it('a prize is one pick, of what she had', () => {
    const run = new Run('gull', 1);
    expect(run.pressPrizeCrew()).toBeNull();
    expect(run.takePrizeGun('pdr6')).toBeNull();
    run.prize = { guns: ['pdr6'], recruits: 0, taken: false };
    expect(run.pressPrizeCrew()).toBeNull();
    expect(run.takePrizeGun('pdr18')).toBeNull();
    expect(run.takePrizeGun('pdr6')).toMatch(/mounted|fetches/);
    expect(run.takePrizeGun('pdr6')).toBeNull();
  });

  it('only the chart has somewhere to sail to', () => {
    const run = new Run('gull', 1);
    run.status = 'port';
    expect(run.reachable()).toEqual([]);
    expect(() => run.jump(1)).toThrow();
  });

  it('an old single-chart voyage counts its legs on its own chart', () => {
    const run = new Run('gull', 1);
    run.chart = generateChart(new Rng(3), { ports: ['A'], armoury: ['pdr6'] });
    run.nodeId = run.chart.nodes.find((n) => n.col === 2)!.id;
    expect(run.legs).toEqual({ sailed: 2, total: run.chart.columns - 1 });
  });
});

/** Hold the wind abeam, for tests about what a plain jump costs. */
function calm(run: Run): Run {
  run.pointOfSail = () => 'beam';
  return run;
}
