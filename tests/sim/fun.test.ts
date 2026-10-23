import { describe, expect, it } from 'vitest';
import { enemy, NAVY_CUTTER } from '../../src/data/enemies';
import { playerShip } from '../../src/data/ships';
import { Battle, gunLoadRate } from '../../src/sim/Battle';
import { canGrapple, updateBoarding } from '../../src/sim/Boarding';
import { applyHit, updateGuns, type CombatStats, type Projectile } from '../../src/sim/Combat';
import { applyBattle, battleRole } from '../../src/sim/commands';
import { updateCrew } from '../../src/sim/Crew';
import { applyCrit, critChance, critKind, CRIT_CHANCE, MAGAZINE_CRIT, MAGAZINE_HULL, MAST_ESCAPE } from '../../src/sim/Crits';
import type { BattleEvent } from '../../src/sim/events';
import { ORDERS, RAKE_DAMAGE, SAIL_EVASION } from '../../src/sim/Orders';
import { Rng } from '../../src/sim/rng';
import { Ship } from '../../src/sim/Ship';
import { applySnapshot, battleSnapshot } from '../../src/sim/snapshot';
import { pickTemper, temperPool, TEMPERS } from '../../src/sim/Temper';

const CALM = { fleeAt: 0, surrenderChance: 0, surrenderAt: 0, temper: 'steady' as const };
const battle = (seed = 1) => new Battle(playerShip('gull'), NAVY_CUTTER, { seed, enemyAI: CALM });

describe("captain's orders", () => {
  it('an order runs for its time, then waits out its cooldown before it can be given again', () => {
    const b = battle();
    expect(b.giveOrder('player', 'rake')).toBe(true);
    expect(b.drainEvents()).toContainEqual({ t: 'order', side: 'player', order: 'rake' });
    expect(b.player.orders.rake.active).toBe(ORDERS.rake.duration);
    expect(b.giveOrder('player', 'rake')).toBe(false);
    for (let t = 0; t < ORDERS.rake.duration + 0.1; t += 0.05) b.step(0.05);
    expect(b.player.orders.rake.active).toBe(0);
    expect(b.canOrder('player', 'rake')).toBe(false);
    for (let t = 0; t < ORDERS.rake.cooldown; t += 0.05) b.step(0.05);
    expect(b.canOrder('player', 'rake') || !!b.outcome).toBe(true);
  });

  it('crowding on sail makes her harder to hit and quicker away, but slows the guns', () => {
    const b = battle();
    const ev = b.player.evasion();
    const rate = b.player.escapeRate();
    const load = gunLoadRate(b.player);
    expect(b.giveOrder('player', 'sail')).toBe(true);
    expect(b.player.evasion()).toBe(Math.min(75, ev + SAIL_EVASION));
    expect(b.player.escapeRate()).toBeCloseTo(rate * 2);
    expect(gunLoadRate(b.player)).toBeLessThan(load);
  });

  it('cold steel needs a grapple, and makes her people hit harder hand to hand', () => {
    const b = battle();
    expect(b.canOrder('player', 'steel')).toBe(false);
    const fight = (fury: number) => {
      const ship = new Ship(playerShip('gull'), 'player');
      const foe = new Ship(NAVY_CUTTER, 'enemy');
      const intruder = foe.crew[0];
      intruder.room = ship.crew[0].room;
      intruder.slot = { x: -1, y: -1 };
      intruder.waypoints = [];
      ship.crew.push(intruder);
      updateBoarding(ship, 1, [], { player: fury });
      return 100 - intruder.hp;
    };
    expect(fight(1.5)).toBeCloseTo(fight(1) * 1.5);
  });

  it('a raking volley flies truer, hits harder and never glances off', () => {
    const b = battle();
    const gun = b.player.guns[0];
    gun.charge = gun.def.loadTime;
    gun.target = 'helm';
    b.player.orders.rake.active = 3;
    const out: Projectile[] = [];
    const stats: CombatStats = { shotsFired: 0, hits: 0, hullDamage: 0 };
    updateGuns(b.player, b.enemy, 0.01, out, [], stats);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].rake).toBe(true);
    expect(out[0].damage).toBe(gun.def.damage + RAKE_DAMAGE);
    // Against stout sides a light ball sometimes glances; a raking one never does.
    const oak = new Ship({ ...NAVY_CUTTER, armour: 9 }, 'enemy');
    const rng = new Rng(3);
    for (let i = 0; i < 40; i++) {
      const events: BattleEvent[] = [];
      applyHit(oak, 'fore', 'round', 1, rng, events, true);
      expect(events.some((e) => e.t === 'hit' && e.deflected)).toBe(false);
      oak.hull = NAVY_CUTTER.hull;
    }
  });

  it('are battle commands, each belonging to one role', () => {
    expect(battleRole({ t: 'order', order: 'rake' })).toBe('gunner');
    expect(battleRole({ t: 'order', order: 'sail' })).toBe('captain');
    expect(battleRole({ t: 'order', order: 'steel' })).toBe('bosun');
    const b = battle();
    expect(applyBattle(b, { t: 'order', order: 'sail' })).toBe(true);
    expect(b.player.orders.sail.active).toBeGreaterThan(0);
  });

  it('travel in the snapshot to a co-op copy', () => {
    const server = battle(4);
    const client = battle(4);
    client.remote = true;
    server.giveOrder('player', 'rake');
    server.step(0.05);
    applySnapshot(client, JSON.parse(JSON.stringify(battleSnapshot(server))));
    expect(client.player.orders.rake).toEqual(server.player.orders.rake);
    expect(battleSnapshot(client)).toEqual(battleSnapshot(server));
  });

  it('AI captains give them in a fight, on both sides', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      const foe = enemy('privateer');
      const b = new Battle(playerShip('gull'), foe.ship, { seed, autoPlayer: true, enemyAI: foe.ai });
      while (!b.outcome && b.time < 300) {
        b.step(0.05);
        for (const e of b.drainEvents()) if (e.t === 'order') seen.add(`${e.side}:${e.order}`);
      }
    }
    expect(seen).toContain('player:rake');
    expect(seen).toContain('enemy:rake');
    expect(seen).toContain('enemy:sail');
  });

  it('an AI mate never gives the captain’s order', () => {
    const b = battle(2);
    b.setMate({ guns: true, hands: true, crew: true });
    for (let i = 0; i < 1200 && !b.outcome; i++) {
      b.step(0.05);
      for (const e of b.drainEvents()) if (e.t === 'order' && e.side === 'player') expect(e.order).not.toBe('sail');
    }
  });
});

describe('critical hits', () => {
  it('chance depends on the shot and the room', () => {
    const s = new Ship(enemy('frigate').ship, 'enemy');
    expect(critChance(s, 'magazine', 'round')).toBe(MAGAZINE_CRIT);
    expect(critChance(s, 'guns', 'hot')).toBe(CRIT_CHANCE);
    expect(critChance(s, 'guns', 'chain')).toBe(0);
    expect(critChance(s, 'sails', 'chain')).toBeGreaterThan(0);
    expect(critChance(s, 'helm', 'grape')).toBeGreaterThan(0);
    expect(critKind(s, 'magazine')).toBe('magazine');
    expect(critKind(s, 'sails')).toBe('mast');
  });

  it('a magazine explosion holes her and sets the room ablaze', () => {
    const s = new Ship(enemy('frigate').ship, 'enemy');
    const events: BattleEvent[] = [];
    const extra = applyCrit(s, 'magazine', 'magazine', new Rng(1), events);
    expect(extra).toBe(MAGAZINE_HULL);
    expect(s.hull).toBe(s.def.hull - MAGAZINE_HULL);
    expect(s.room('magazine').flames.every((f) => f > 0)).toBe(true);
    expect(events).toContainEqual({ t: 'crit', side: 'enemy', room: 'magazine', kind: 'magazine' });
  });

  it('a falling mast stops a runner and wrecks her sails', () => {
    const s = new Ship(NAVY_CUTTER, 'enemy');
    s.escape = 80;
    applyCrit(s, 'sails', 'mast', new Rng(1), []);
    expect(s.escape).toBe(80 - MAST_ESCAPE);
    expect(s.system('sails')!.damage).toBe(1);
  });

  it('strikes down the helmsman, stoves in bulwarks and holes her below the waterline', () => {
    const s = new Ship(NAVY_CUTTER, 'enemy');
    const helmsman = s.crew.find((c) => c.room === 'helm')!;
    helmsman.task = 'man';
    const events: BattleEvent[] = [];
    applyCrit(s, 'helm', 'helmsman', new Rng(1), events);
    expect(helmsman.hp).toBeLessThan(100);
    expect(events.at(-1)).toMatchObject({ t: 'crit', kind: 'helmsman', name: helmsman.name });
    applyCrit(s, 'fore', 'bulwarks', new Rng(1), []);
    expect(s.layers).toBe(0);
    applyCrit(s, 'pumps', 'waterline', new Rng(1), []);
    expect(s.room('pumps').breach).toBe(true);
    expect(s.room('pumps').water).toBeGreaterThan(0);
  });

  it('turn up in fights, and the same seed gives the same ones', () => {
    const crits = (seed: number) => {
      const foe = enemy('cutter');
      const b = new Battle(playerShip('gull'), foe.ship, { seed, autoPlayer: true, enemyAI: foe.ai, allowEscape: false });
      const out: string[] = [];
      while (!b.outcome && b.time < 600) {
        b.step(0.05);
        for (const e of b.drainEvents()) if (e.t === 'crit') out.push(`${e.side}:${e.kind}@${b.time.toFixed(2)}`);
      }
      return out;
    };
    let any = 0;
    for (let seed = 1; seed <= 8; seed++) any += crits(seed).length;
    expect(any).toBeGreaterThan(0);
    expect(crits(3)).toEqual(crits(3));
  });
});

describe('enemy captain tempers', () => {
  it('are picked from her ship’s pool by the seed, the same every time', () => {
    for (let seed = 1; seed < 40; seed++) {
      expect(temperPool('rival')).toContain(pickTemper('rival', seed));
      expect(pickTemper('rival', seed)).toBe(pickTemper('rival', seed));
    }
    expect(new Set(Array.from({ length: 40 }, (_, i) => pickTemper('rival', i))).size).toBeGreaterThan(1);
    expect(pickTemper('frigate', 7)).toBe('steady');
    const a = new Battle(playerShip('gull'), enemy('privateer').ship, { seed: 11 });
    const b = new Battle(playerShip('gull'), enemy('privateer').ship, { seed: 11 });
    expect(a.temper).toBe(b.temper);
  });

  it('a long-gun captain shoots truer and never boards', () => {
    const foe = enemy('privateer');
    const b = new Battle(playerShip('maw'), foe.ship, { seed: 1, enemyAI: { ...foe.ai, temper: 'gunner' } });
    expect(b.enemy.aimBonus).toBe(TEMPERS.gunner.aimBonus);
    expect(b.enemy.keepsRange).toBe(true);
    for (let i = 0; i < 2400 && !b.outcome; i++) {
      b.step(0.05);
      for (const e of b.drainEvents()) expect(e.t === 'board' && e.side === 'enemy').toBe(false);
    }
  });

  it('keeping the range holds off an equal ship until her sails are hurt; closing in catches a quicker one', () => {
    const a = new Ship(NAVY_CUTTER, 'player');
    const b = new Ship(NAVY_CUTTER, 'enemy');
    // Someone at each wheel (an unmanned helm can't steer away from anybody).
    for (const s of [a, b]) updateCrew(s, 0);
    expect(canGrapple(a, b)).toBe(true);
    b.keepsRange = true;
    expect(canGrapple(a, b)).toBe(false);
    b.system('sails')!.damage = 1;
    expect(canGrapple(a, b)).toBe(true);
    const quick = new Ship({ ...NAVY_CUTTER, speedBonus: NAVY_CUTTER.speedBonus + 5 }, 'enemy');
    updateCrew(quick, 0);
    expect(canGrapple(a, quick)).toBe(false);
    a.closesIn = true;
    expect(canGrapple(a, quick)).toBe(true);
    const corsair = new Battle(playerShip('wren'), enemy('corsair').ship, { seed: 1, enemyAI: { ...enemy('corsair').ai, temper: 'boarder' } });
    expect(corsair.enemy.closesIn).toBe(true);
  });

  it('a faint-heart strikes more readily, a firebrand loads hot shot', () => {
    const foe = enemy('smuggler');
    const steady = new Battle(playerShip('gull'), foe.ship, { seed: 1, enemyAI: { ...foe.ai, temper: 'steady' } });
    const coward = new Battle(playerShip('gull'), foe.ship, { seed: 1, enemyAI: { ...foe.ai, temper: 'coward' } });
    const opts = (x: Battle) => (x as unknown as { enemyAI: { opts: { surrenderChance: number } } }).enemyAI.opts;
    expect(opts(coward).surrenderChance).toBeGreaterThan(opts(steady).surrenderChance);
    const fire = new Battle(playerShip('gull'), foe.ship, { seed: 1, enemyAI: { ...foe.ai, temper: 'firebrand' } });
    for (let i = 0; i < 40; i++) fire.step(0.05);
    expect(fire.enemy.guns.some((g) => g.shot === 'hot')).toBe(true);
    expect(fire.enemy.shotRate.hot).toBeGreaterThan(1);
  });
});
