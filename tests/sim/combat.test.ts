import { describe, expect, it } from 'vitest';
import { NAVY_CUTTER } from '../../src/data/enemies';
import { playerShip } from '../../src/data/ships';
import { applyHit, changeShot, hitChance, updateGuns, type CombatStats, type Projectile } from '../../src/sim/Combat';
import { updateCrew } from '../../src/sim/Crew';
import type { BattleEvent } from '../../src/sim/events';
import { Rng } from '../../src/sim/rng';
import { Ship } from '../../src/sim/Ship';

const stats = (): CombatStats => ({ shotsFired: 0, hits: 0, hullDamage: 0 });

describe('evasion and hit chance', () => {
  it('an unmanned helm means every ball hits', () => {
    const ship = new Ship(NAVY_CUTTER, 'enemy');
    expect(ship.evasion()).toBe(0);
    expect(hitChance(ship, 0)).toBe(1);
  });

  it('a manned, sailing sloop is hard to hit', () => {
    const wren = new Ship(playerShip('wren'), 'player');
    updateCrew(wren, 0.05);
    expect(wren.evasion()).toBeGreaterThanOrEqual(30);
    expect(hitChance(wren, 10)).toBeLessThan(hitChance(wren, 0));
  });
});

describe('shot types', () => {
  const rng = new Rng(1);

  it('round shot damages hull and the system in the room', () => {
    const ship = new Ship(NAVY_CUTTER, 'enemy');
    applyHit(ship, 'guns', 'round', 2, rng, []);
    expect(ship.hull).toBe(NAVY_CUTTER.hull - 2);
    expect(ship.system('guns')!.damage).toBe(2);
  });

  it('chain shot spares the hull but wrecks sails and rigging', () => {
    const ship = new Ship(NAVY_CUTTER, 'enemy');
    ship.escape = 50;
    applyHit(ship, 'sails', 'chain', 1, rng, []);
    expect(ship.hull).toBe(NAVY_CUTTER.hull);
    expect(ship.system('sails')!.damage).toBe(2);
    expect(ship.escape).toBeLessThan(50);
  });

  it('grape shot hurts everyone in the room and nothing else', () => {
    const ship = new Ship(NAVY_CUTTER, 'enemy');
    applyHit(ship, 'helm', 'grape', 1, rng, []);
    expect(ship.hull).toBe(NAVY_CUTTER.hull);
    expect(ship.system('helm')!.damage).toBe(0);
    expect(ship.crew.find((c) => c.room === 'helm')!.hp).toBe(65);
  });

  it('hot shot usually starts a fire', () => {
    let fires = 0;
    const r = new Rng(7);
    for (let i = 0; i < 200; i++) {
      const ship = new Ship(NAVY_CUTTER, 'enemy');
      const ev: BattleEvent[] = [];
      applyHit(ship, 'fore', 'hot', 1, r, ev);
      if (ship.room('fore').fire > 0) fires++;
    }
    expect(fires).toBeGreaterThan(110);
    expect(fires).toBeLessThan(170);
  });
});

describe('guns', () => {
  it('fires a volley once loaded and aimed, then reloads', () => {
    const wren = new Ship(playerShip('wren'), 'player');
    const cutter = new Ship(NAVY_CUTTER, 'enemy');
    const out: Projectile[] = [];
    const s = stats();
    wren.guns[1].target = 'helm'; // 9-pounder, 2 balls, 11 s
    for (let t = 0; t < 10.9; t += 0.05) updateGuns(wren, cutter, 0.05, out, [], s);
    expect(out).toHaveLength(0);
    for (let t = 0; t < 0.3; t += 0.05) updateGuns(wren, cutter, 0.05, out, [], s);
    expect(out).toHaveLength(2);
    expect(wren.guns[1].charge).toBeLessThan(1);
  });

  it('switching shot costs some load', () => {
    const wren = new Ship(playerShip('wren'), 'player');
    wren.guns[0].charge = 5;
    changeShot(wren.guns[0], 'hot');
    expect(wren.guns[0].charge).toBe(3);
  });
});
