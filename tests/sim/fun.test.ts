import { describe, expect, it } from 'vitest';
import { CHALLENGES, challengeRenown } from '../../src/data/challenges';
import { FITTINGS, RARE_FITTING_IDS, fittingEffects } from '../../src/data/fittings';
import { autoRun, autoStep } from '../../src/sim/autoRun';
import { highlights, type LogEntry } from '../../src/sim/chronicle';
import { DIFFICULTY, MAX_PROVISIONS, Run } from '../../src/sim/Run';

/** A run with a battle against a cutter ready to start. */
function atBattle(run: Run, enemy = 'cutter'): Run {
  run.encounter = { kind: 'battle', enemy, name: 'HMS Test', boss: false, ambush: false, text: '' };
  run.status = 'battle';
  return run;
}

describe('rare fittings and synergies', () => {
  it('rare fittings are marked rare, and every one has a drawback or a price in its words', () => {
    expect(RARE_FITTING_IDS.length).toBeGreaterThanOrEqual(3);
    for (const id of RARE_FITTING_IDS) {
      expect(FITTINGS[id].short, id).toMatch(/^Rare ·/);
      expect(FITTINGS[id].effects, id).toBeDefined();
    }
  });

  it('live-oak doubling gives stout sides and costs evasion', () => {
    const run = new Run('gull', 3);
    const base = run.ship;
    run.fittings.push('oak');
    expect(run.ship.armour).toBe(1);
    expect(run.ship.speedBonus).toBe(base.speedBonus - 5);
    const b = atBattle(run).startBattle();
    expect(b.player.armour).toBe(1);
  });

  it('the red flag: crew fight harder and no ship strikes to you', () => {
    const run = atBattle(new Run('gull', 3), 'merchant');
    const plain = run.battleSetup();
    expect(plain.options.enemyAI?.surrenderChance).toBeGreaterThan(0);
    const melee = run.ship.melee ?? 1;
    run.fittings.push('redflag', 'figurehead');
    expect(run.ship.melee).toBeCloseTo(melee * 1.3);
    expect(run.battleSetup().options.enemyAI?.surrenderChance).toBe(0);
    expect(run.battleSetup().options.enemyReload).toBeCloseTo(plain.options.enemyReload! * 0.9);
  });

  it('double-shotted guns load faster, except chain and grape; shot lockers and a furnace stack with them', () => {
    const run = atBattle(new Run('gull', 3));
    run.fittings.push('doubleshot');
    let o = run.battleSetup().options;
    expect(o.playerReload).toBeCloseTo(1.2);
    expect(o.playerShotRate).toEqual({ chain: 0.75, grape: 0.75 });
    run.fittings.push('lockers', 'furnace', 'drill');
    o = run.battleSetup().options;
    expect(o.playerReload).toBeCloseTo(1.2 * 1.1);
    expect(o.playerShotRate?.chain).toBeCloseTo(0.75 * 1.3);
    expect(o.playerShotRate?.hot).toBeCloseTo(1.3);
    expect(o.playerShotRate?.round).toBeUndefined();
  });

  it('a plain ship has no shot rates at all', () => {
    expect(atBattle(new Run('gull', 3)).battleSetup().options.playerShotRate).toBeUndefined();
  });

  it('fitting effects add evasion and multiply rates', () => {
    const fx = fittingEffects(['oak', 'doubleshot', 'furnace', 'drill']);
    expect(fx.evasion).toBe(-5);
    expect(fx.armour).toBe(1);
    expect(fx.reload).toBeCloseTo(1.2);
    expect(fx.shotRate.hot).toBeCloseTo(1.3);
    expect(fittingEffects([])).toEqual({ evasion: 0, armour: 0, melee: 1, reload: 1, shotRate: {}, noQuarter: false, enemyReload: 1 });
  });

  it('spare spars mend a point of hull each jump, never above her max', () => {
    const run = new Run('gull', 5);
    run.fittings.push('spars');
    run.condition.hull = run.fit.hull - 3;
    run.jump(run.reachable()[0].id);
    expect(run.condition.hull).toBeGreaterThanOrEqual(run.fit.hull - 2);
    expect(run.condition.hull).toBeLessThanOrEqual(run.fit.hull);
  });

  it('chandlers stock rare fittings only beyond the first sector, and now and then', () => {
    let rareSeen = 0;
    let ports = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const run = new Run('maw', seed);
      for (let guard = 0; guard < 100 && !run.over; guard++) {
        if (run.status === 'port' && run.encounter.kind === 'port') {
          const rare = (run.encounter.fittings ?? []).filter((id) => FITTINGS[id].rare);
          if (run.sector === 0) expect(rare).toEqual([]);
          else {
            ports++;
            rareSeen += rare.length;
            expect(rare.length).toBeLessThanOrEqual(1);
          }
        }
        autoStep(run, { focus: 'guns' });
      }
    }
    expect(ports).toBeGreaterThan(10);
    expect(rareSeen).toBeGreaterThan(0);
    expect(rareSeen).toBeLessThan(ports);
  }, 30_000);
});

describe('challenges', () => {
  it('none chosen leaves the voyage as it always was', () => {
    const run = new Run('gull', 9);
    expect(run.challenges).toEqual([]);
    expect(run.gold).toBe(DIFFICULTY.normal.startGold);
    expect(run.maxProvisions).toBe(MAX_PROVISIONS);
    expect(challengeRenown([])).toBe(1);
  });

  it('each hardship does what it says', () => {
    const plain = new Run('gull', 9);
    const hard = new Run('gull', 9, 'normal', 'rover', CHALLENGES.map((c) => c.id));
    expect(hard.gold).toBe(0);
    expect(hard.provisions).toBe(plain.provisions - 4);
    expect(hard.maxProvisions).toBe(plain.maxProvisions - 6);
    expect(hard.fit.hull).toBe(Math.round(plain.fit.hull * 0.75));
    expect(hard.condition.hull).toBe(hard.fit.hull);
    expect(hard.navySpeed).toBeCloseTo(plain.navySpeed + 0.15);
  });

  it('hardships earn their share of renown', () => {
    const plain = new Run('gull', 9);
    const hard = new Run('gull', 9, 'normal', 'rover', ['hunted', 'leaky']);
    plain.battlesWon = hard.battlesWon = 4;
    expect(hard.renown).toBe(Math.round((plain.renown * 1.6)));
  });

  it('an unknown challenge is refused, and a repeated one counts once', () => {
    expect(() => new Run('gull', 1, 'normal', 'rover', ['nonsense'])).toThrow();
    expect(new Run('gull', 1, 'normal', 'rover', ['pauper', 'pauper']).challenges).toEqual(['pauper']);
  });

  it('challenges and the log survive a save, and an old save without them still loads', () => {
    const run = new Run('wren', 21, 'normal', 'rover', ['rations', 'hunted']);
    autoRun(run, { focus: 'guns' });
    const back = Run.fromSave(JSON.parse(JSON.stringify(run.toSave())));
    expect(back.challenges).toEqual(['rations', 'hunted']);
    expect(back.log).toEqual(run.log);
    expect(back.maxProvisions).toBe(run.maxProvisions);
    expect(back.renown).toBe(run.renown);
    const old = { ...run.toSave() } as Partial<ReturnType<Run['toSave']>>;
    delete old.challenges;
    delete old.log;
    const legacy = Run.fromSave(old as ReturnType<Run['toSave']>);
    expect(legacy.challenges).toEqual([]);
    expect(legacy.log).toEqual([]);
  });
});

describe("the ship's log", () => {
  it('records every fight, purchase and passage of a voyage, in order', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { run, battles } = autoRun(new Run('gull', seed), { focus: 'guns' });
      const fights = run.log.filter((e) => e.kind === 'battle');
      expect(fights.length).toBe(battles.length);
      expect(run.log.filter((e) => e.kind === 'sector').length).toBe(run.sector);
      const jumps = run.log.map((e) => e.jump);
      expect(jumps).toEqual([...jumps].sort((a, b) => a - b));
      for (const f of fights) {
        expect(f.hullLeft).toBeGreaterThanOrEqual(0);
        expect(f.dealt).toBeGreaterThanOrEqual(0);
        expect(f.name).toBeTruthy();
      }
    }
  });

  it('replays exactly from the same seed', () => {
    const a = autoRun(new Run('wolf', 33, 'normal', 'rover', ['pauper']), { boardWith: 2 }).run;
    const b = autoRun(new Run('wolf', 33, 'normal', 'rover', ['pauper']), { boardWith: 2 }).run;
    expect(b.log).toEqual(a.log);
    expect(b.toSave()).toEqual(a.toSave());
  });

  it('picks out the memorable moments', () => {
    const log: LogEntry[] = [
      { jump: 2, sector: 0, kind: 'battle', text: '', name: 'Fat Molly', outcome: 'surrender', won: true, gold: 60, hullLeft: 0.9, dealt: 8, time: 50 },
      { jump: 3, sector: 0, kind: 'prize', text: '', name: 'Fat Molly' },
      { jump: 5, sector: 1, kind: 'battle', text: '', name: 'La Furie', outcome: 'enemySunk', won: true, gold: 20, hullLeft: 0.2, dealt: 30, time: 200 },
      { jump: 6, sector: 1, kind: 'buy', text: '', item: 'oak', gold: 108 },
      { jump: 7, sector: 1, kind: 'battle', text: '', name: 'HMS Swift', outcome: 'sunk', won: false, hullLeft: 0, dealt: 4, time: 300 },
    ];
    const h = highlights(log, 10);
    const by = (label: string) => h.find((x) => x.label === label)?.text ?? '';
    expect(by('Richest prize')).toMatch(/Fat Molly.*60 gold/);
    expect(by('Closest call')).toMatch(/La Furie.*20%/);
    expect(by('Hottest broadsides')).toMatch(/30 hull.*La Furie/);
    expect(by('Longest fight')).toMatch(/5 minutes.*HMS Swift/);
    expect(by('Prize in company')).toBe('Fat Molly');
    expect(by('Rare finds')).toBe('Live-Oak Doubling');
    expect(by('Battle record')).toBe('2 won of 3 fought');
    expect(highlights([])).toEqual([]);
    expect(highlights(log, 2)).toHaveLength(2);
  });
});
