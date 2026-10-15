import { describe, expect, it } from 'vitest';
import { MERCHANT_BRIG, NAVY_CUTTER } from '../../src/data/enemies';
import { playerShip } from '../../src/data/ships';
import { Battle } from '../../src/sim/Battle';
import { updateCrew } from '../../src/sim/Crew';
import type { BattleEvent } from '../../src/sim/events';
import { Run } from '../../src/sim/Run';
import { Ship, type Crew } from '../../src/sim/Ship';
import { badges, rank, RANK_XP, SEAMANSHIP_EVASION, train } from '../../src/sim/Skills';

const settle = (ship: Ship) => {
  for (let i = 0; i < 4; i++) updateCrew(ship, 0.05);
};

describe('skills', () => {
  it('ranks up at the thresholds and announces it', () => {
    const c = new Ship(playerShip('gull'), 'player').crew[0];
    const events: BattleEvent[] = [];
    expect(rank(c, 'gunnery')).toBe(0);
    train(c, 'gunnery', RANK_XP[1], events);
    expect(rank(c, 'gunnery')).toBe(1);
    train(c, 'gunnery', RANK_XP[2], events);
    expect(rank(c, 'gunnery')).toBe(2);
    expect(events.map((e) => (e.t === 'log' ? e.text : ''))).toEqual([`${c.name} is now a Veteran gunner!`, `${c.name} is now an Expert gunner!`]);
    expect(badges(c)).toBe('★★G');
  });

  it('only your own crew learn', () => {
    const c = new Ship(NAVY_CUTTER, 'enemy').crew[0];
    train(c, 'combat', 500);
    expect(rank(c, 'combat')).toBe(0);
  });

  it('an expert helmsman makes the ship harder to hit', () => {
    const ship = new Ship(playerShip('gull'), 'player');
    settle(ship);
    const before = ship.evasion();
    ship.stationed('helm')!.xp.seamanship = RANK_XP[2];
    expect(ship.evasion()).toBe(Math.min(60, before + 2 * SEAMANSHIP_EVASION));
  });

  it('an expert gunner loads faster, and gunners learn by firing', () => {
    const firstVolley = (expert: boolean) => {
      const b = new Battle(playerShip('gull'), MERCHANT_BRIG, { seed: 3, enemyAI: { fleeAt: 0, surrenderChance: 0, surrenderAt: 0 } });
      b.player.guns.forEach((g) => (g.target = 'hold'));
      b.enemy.guns.splice(0);
      b.step(0.05);
      const gunner = b.player.stationed('guns') as Crew;
      if (expert) gunner.xp.gunnery = RANK_XP[2];
      while (!b.stats.player.shotsFired) b.step(0.05);
      return { time: b.time, xp: gunner.xp.gunnery ?? 0 };
    };
    const green = firstVolley(false);
    const expert = firstVolley(true);
    expect(expert.time).toBeLessThan(green.time);
    expect(green.xp).toBeGreaterThan(0);
  });

  it('expert carpenters repair faster', () => {
    const repairTime = (expert: boolean) => {
      const ship = new Ship(playerShip('gull'), 'player');
      settle(ship);
      ship.damageSystem('sails', 1);
      if (expert) for (const c of ship.crewInRoom('sails')) c.xp.repair = RANK_XP[2];
      let t = 0;
      while (ship.system('sails')!.damage > 0) {
        updateCrew(ship, 0.05);
        t += 0.05;
      }
      return t;
    };
    expect(repairTime(true)).toBeLessThan(repairTime(false));
  });

  it('experience survives between battles and saves', () => {
    const run = new Run('gull', 4);
    run.condition.crew[0].xp = { gunnery: 70 };
    const ship = new Ship(run.ship, 'player', run.condition);
    expect(rank(ship.crew[0], 'gunnery')).toBe(1);
    expect(ship.condition().crew[0].xp).toEqual({ gunnery: 70 });
    const back = Run.fromSave(JSON.parse(JSON.stringify(run.toSave())));
    expect(back.condition.crew[0].xp).toEqual({ gunnery: 70 });
  });
});
