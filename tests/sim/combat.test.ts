import { describe, expect, it } from 'vitest';
import { NAVY_CUTTER } from '../../src/data/enemies';
import { playerShip } from '../../src/data/ships';
import { applyHit, BULWARK_RECHARGE, changeShot, hitChance, UNCREWED_RELOAD, updateBulwarks, updateGuns, updateProjectiles, type CombatStats, type Projectile } from '../../src/sim/Combat';
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
    applyHit(ship, 'sails', 'round', 2, rng, []);
    expect(ship.hull).toBe(NAVY_CUTTER.hull - 2);
    expect(ship.system('sails')!.damage).toBe(2);
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
    wren.guns[1].target = 'helm'; // 9-pounder, 2 balls, 11 s; one gunner loads at 1.15x
    updateCrew(wren, 0); // helm manned, so the guns can be brought to bear
    expect(wren.gunCrew()).toHaveLength(1);
    for (let t = 0; t < 9.4; t += 0.05) updateGuns(wren, cutter, 0.05, out, [], s);
    expect(out).toHaveLength(0);
    for (let t = 0; t < 0.4; t += 0.05) updateGuns(wren, cutter, 0.05, out, [], s);
    expect(out).toHaveLength(2);
    expect(wren.guns[1].charge).toBeLessThan(1);
  });

  it('loads at a crawl with nobody at the guns', () => {
    const wren = new Ship(playerShip('wren'), 'player');
    const cutter = new Ship(NAVY_CUTTER, 'enemy');
    for (const c of wren.crew) if (c.room === 'guns') c.room = 'fore';
    updateCrew(wren, 0);
    expect(wren.gunCrew()).toHaveLength(0);
    for (let t = 0; t < 5; t += 0.05) updateGuns(wren, cutter, 0.05, [], [], stats());
    expect(wren.guns[1].charge).toBeCloseTo(5 * UNCREWED_RELOAD, 1);
  });

  it('light balls often glance off stout sides; chain shot does not', () => {
    const rng = new Rng(11);
    const armoured = new Ship({ ...NAVY_CUTTER, armour: 1 }, 'enemy');
    let glanced = 0;
    for (let i = 0; i < 200; i++) {
      const ev: BattleEvent[] = [];
      applyHit(armoured, 'fore', 'round', 1, rng, ev);
      if (ev.some((e) => e.t === 'hit' && e.deflected)) glanced++;
    }
    expect(glanced).toBeGreaterThan(55);
    expect(glanced).toBeLessThan(105);
    const heavy: BattleEvent[] = [];
    applyHit(armoured, 'fore', 'round', 2, rng, heavy);
    expect(heavy.some((e) => e.t === 'hit' && e.deflected)).toBe(false);
    const chained = new Ship({ ...NAVY_CUTTER, armour: 1 }, 'enemy');
    for (let i = 0; i < 20; i++) applyHit(chained, 'sails', 'chain', 1, rng, []);
    expect(chained.system('sails')!.damage).toBeGreaterThan(0);
  });

  it('switching shot costs some load', () => {
    const wren = new Ship(playerShip('wren'), 'player');
    wren.guns[0].charge = 5;
    changeShot(wren.guns[0], 'hot');
    expect(wren.guns[0].charge).toBe(3);
  });
});

describe('bulwarks', () => {
  it('stop one ball per layer, recharge, and let chain shot through', () => {
    const rng = new Rng(3);
    const gull = new Ship(playerShip('gull'), 'player');
    const cutter = new Ship(NAVY_CUTTER, 'enemy');
    cutter.crew = [];
    expect(cutter.layers).toBe(1);
    const ships = { player: gull, enemy: cutter };
    const st = { player: stats(), enemy: stats() };
    const ball = (shot: 'round' | 'chain'): Projectile => ({ from: 'player', gun: 0, shot, room: 'helm', damage: 1, inaccuracy: -100, t: 5, delay: 0 });
    const ev: BattleEvent[] = [];
    updateProjectiles([ball('round'), ball('round')], ships, 0.05, rng, ev, st);
    expect(ev.filter((e) => e.t === 'block')).toHaveLength(1);
    expect(cutter.layers).toBe(0);
    expect(cutter.hull).toBe(NAVY_CUTTER.hull - 1);
    for (let t = 0; t < BULWARK_RECHARGE + 0.1; t += 0.05) updateBulwarks(cutter, 0.05);
    expect(cutter.layers).toBe(1);
    const ev2: BattleEvent[] = [];
    updateProjectiles([ball('chain')], ships, 0.05, rng, ev2, st);
    expect(ev2.some((e) => e.t === 'block')).toBe(false);
    expect(cutter.layers).toBe(1);
  });

  it('a broadside holds every gun until all are loaded', () => {
    const gull = new Ship(playerShip('gull'), 'player');
    const cutter = new Ship(NAVY_CUTTER, 'enemy');
    gull.broadside = true;
    gull.guns.forEach((g) => (g.target = 'guns'));
    const out: Projectile[] = [];
    let firstVolley = -1;
    for (let t = 0; t < 30 && firstVolley < 0; t += 0.05) {
      updateGuns(gull, cutter, 0.05, out, [], stats());
      if (out.length) firstVolley = t;
    }
    // Every gun's balls leave in the same tick.
    expect(out.length).toBe(gull.guns.filter((g) => g.powered).reduce((n, g) => n + g.def.shots, 0));
  });
});
