import { describe, expect, it } from 'vitest';
import { enemy, MERCHANT_BRIG, NAVY_CUTTER } from '../../src/data/enemies';
import { playerShip } from '../../src/data/ships';
import { Battle } from '../../src/sim/Battle';
import { BOARD_TIME, canGrapple, DEFENDER_BONUS, grappleSpeed, land, partyStrength, SABOTAGE_RATE, updateBoarding } from '../../src/sim/Boarding';
import type { BattleEvent } from '../../src/sim/events';
import { Ship } from '../../src/sim/Ship';

/** Run the battle for some seconds of game time (stops early if it ends). */
function run(b: Battle, seconds: number): void {
  for (let t = 0; t < seconds && !b.outcome; t += 0.05) b.step(0.05);
}

/** A quiet battle: nobody shoots, so only boarding matters. */
function quiet(seed = 1, enemyDef = MERCHANT_BRIG): Battle {
  const b = new Battle(playerShip('maw'), enemyDef, { seed, enemyAI: { fleeAt: 0, surrenderChance: 0, surrenderAt: 0 } });
  for (const g of [...b.player.guns, ...b.enemy.guns]) g.powered = g.wanted = false;
  return b;
}

describe('grappling', () => {
  it('needs to be at least as fast as her (sails plus hull speed), unless nobody is at her helm', () => {
    const a = new Ship(playerShip('gull'), 'player');
    const b = new Ship(NAVY_CUTTER, 'enemy');
    const steer = (s: Ship) => s.crew.forEach((c) => c.room === s.system('helm')!.room && (c.task = 'man'));
    steer(a);
    steer(b);
    a.system('sails')!.hands = 3;
    b.system('sails')!.hands = 2;
    expect(grappleSpeed(b)).toBe(3);
    expect(canGrapple(a, b)).toBe(true);
    b.system('sails')!.hands = 3;
    expect(canGrapple(a, b)).toBe(false);
    b.crew.forEach((c) => (c.task = 'idle'));
    expect(canGrapple(a, b)).toBe(true);
  });
});

describe('boarding', () => {
  it('sends crew across, lands them after the crossing, and lashes the ships together', () => {
    const b = quiet();
    b.step(0.05);
    b.enemy.damageSystem('sails', 9);
    const c = b.player.crew[1];
    expect(b.canBoard()).toBe(true);
    expect(b.moveCrew(c.id, 'hold', 'enemy')).toBe(true);
    expect(b.player.crew).not.toContain(c);
    expect(b.transit).toHaveLength(1);
    expect(b.grappled).toBe(true);
    run(b, BOARD_TIME + 0.1);
    expect(b.enemy.crew).toContain(c);
    expect(c.side).toBe('player');
    expect(b.enemy.boarders()).toContain(c);
    b.player.escape = 100;
    expect(b.canEscape()).toBe(false);
  });

  it('refuses to board a ship that can out-sail you', () => {
    const b = quiet();
    b.player.system('sails')!.hands = 0;
    b.player.system('sails')!.wanted = 0;
    b.step(0.05);
    expect(b.canBoard()).toBe(false);
    expect(b.moveCrew(b.player.crew[1].id, 'hold', 'enemy')).toBe(false);
  });

  it('boarders and defenders fight hand to hand: numbers win, and defenders have the edge', () => {
    const fight = (boarders: number, defenders: number, def = NAVY_CUTTER, room = 'guns') => {
      const ship = new Ship(def, 'enemy');
      const mine = ship.crew.slice(0, defenders);
      ship.crew = mine;
      for (const c of mine) land(ship, ship.crew.splice(ship.crew.indexOf(c), 1)[0], room);
      const raiders = new Ship(playerShip('maw'), 'player').crew.slice(0, boarders);
      for (const c of raiders) land(ship, c, room);
      for (let t = 0; t < 60 && ship.own().some((c) => c.hp > 0) && raiders.some((c) => c.hp > 0); t += 0.05) {
        updateBoarding(ship, 0.05, []);
        ship.crew = ship.crew.filter((c) => c.hp > 0);
      }
      return { boardersLeft: raiders.filter((c) => c.hp > 0).length, defendersLeft: ship.own().length };
    };
    expect(fight(3, 1).defendersLeft).toBe(0);
    expect(fight(1, 2).boardersLeft).toBe(0);
    // One against one, a Navy defender wins; a merchant hand does not.
    expect(fight(1, 1).defendersLeft).toBe(1);
    expect(fight(1, 1, MERCHANT_BRIG, 'hold').boardersLeft).toBe(1);
  });

  it('unopposed boarders wreck the system in the room', () => {
    const ship = new Ship(MERCHANT_BRIG, 'enemy');
    ship.crew = ship.crew.filter((c) => c.room !== 'guns');
    const raiders = new Ship(playerShip('maw'), 'player').crew.slice(0, 2);
    for (const c of raiders) land(ship, c, 'guns');
    const events: BattleEvent[] = [];
    for (let t = 0; t < 100 / (SABOTAGE_RATE * 2) + 0.5; t += 0.05) updateBoarding(ship, 0.05, events);
    expect(ship.system('guns')!.damage).toBe(1);
    expect(raiders.every((c) => c.task === 'sabotage')).toBe(true);
    expect(events.some((e) => e.t === 'log')).toBe(true);
  });

  it('defenders in the room stop the sabotage and fight instead', () => {
    const ship = new Ship(MERCHANT_BRIG, 'enemy');
    const raider = new Ship(playerShip('maw'), 'player').crew[0];
    land(ship, raider, 'guns');
    for (let t = 0; t < 30; t += 0.05) updateBoarding(ship, 0.05, []);
    expect(ship.system('guns')!.damage).toBe(0);
    expect(raider.hp).toBeLessThan(100);
  });

  it('killing every enemy crew member captures her, and the boarders come home', () => {
    const b = quiet();
    const party = b.player.crew.slice(1);
    b.board('player', party, 'hold');
    run(b, BOARD_TIME + 0.2);
    for (const c of b.enemy.own()) c.hp = 0;
    b.step(0.05);
    expect(b.outcome?.kind).toBe('captured');
    expect(b.enemy.boarders()).toHaveLength(0);
    const names = b.player.condition().crew.map((c) => c.name);
    for (const c of party) expect(names).toContain(c.name);
  });

  it('boarders can be called back home', () => {
    const b = quiet();
    const c = b.player.crew[1];
    b.board('player', [c], 'hold');
    run(b, BOARD_TIME + 0.2);
    expect(b.moveCrew(c.id, c.home, 'player')).toBe(true);
    run(b, BOARD_TIME + 0.2);
    expect(b.player.crew).toContain(c);
    expect(b.grappled).toBe(false);
  });

  it('a fleeing ship cannot make sail while grappled', () => {
    const b = new Battle(playerShip('maw'), MERCHANT_BRIG, { seed: 2, enemyAI: { fleeAt: 1, surrenderChance: 0, surrenderAt: 0 } });
    b.step(0.05);
    expect(b.enemyFleeing).toBe(true);
    b.board('player', [b.player.crew[1]], 'hold');
    const before = b.enemy.escape;
    run(b, 3);
    expect(b.enemy.escape).toBe(before);
  });
});

describe('boarding odds', () => {
  it('party strength weighs fighting stock, health and the defenders\' edge', () => {
    const merchants = new Ship(MERCHANT_BRIG, 'enemy').crew.slice(0, 2);
    const raiders = new Ship(playerShip('maw'), 'player').crew.slice(0, 2);
    expect(partyStrength(raiders)).toBeCloseTo(2, 6);
    raiders[0].hp = 50;
    expect(partyStrength(raiders)).toBeCloseTo(1.5, 6);
    const m = MERCHANT_BRIG.melee ?? 1;
    expect(partyStrength(merchants, true)).toBeCloseTo(2 * m * DEFENDER_BONUS, 6);
  });
});

describe('holding fire while boarding', () => {
  it("the player's guns load but do not fire while her boarders are crossing or aboard, then fire once they are back", () => {
    const b = new Battle(playerShip('maw'), MERCHANT_BRIG, { seed: 4, enemyAI: { fleeAt: 0, surrenderChance: 0, surrenderAt: 0 } });
    for (const g of b.enemy.guns) g.powered = g.wanted = false;
    b.player.guns.forEach((g, i) => {
      b.aimGun(i, 'hold');
      g.charge = g.def.loadTime - 1;
    });
    const c = b.player.crew[1];
    b.board('player', [c], 'hold');
    run(b, BOARD_TIME + 2);
    expect(b.enemy.crew).toContain(c);
    expect(b.holdingFire).toBe(true);
    expect(b.stats.player.shotsFired).toBe(0);
    expect(b.player.guns.filter((g) => g.powered).every((g) => g.charge >= g.def.loadTime && g.target === 'hold')).toBe(true);
    const logs = b.drainEvents().filter((e) => e.t === 'log' && e.text.includes('hold fire'));
    expect(logs).toHaveLength(1);
    // Call the boarder back: once she is aboard her own ship again, the waiting guns fire.
    b.moveCrew(c.id, c.home, 'player');
    run(b, BOARD_TIME + 0.2);
    expect(b.holdingFire).toBe(false);
    expect(b.stats.player.shotsFired).toBeGreaterThan(0);
  });
});

describe('boarding AI', () => {
  it('a privateer sends a party across when she can grapple, and our AI captain repels it', () => {
    let boarded = false;
    let repelled = false;
    for (let seed = 1; seed <= 6 && !(boarded && repelled); seed++) {
      const foe = enemy('privateer');
      const b = new Battle(playerShip('gull'), foe.ship, { seed, autoPlayer: true, enemyAI: foe.ai });
      for (let t = 0; t < 120 && !b.outcome; t += 0.05) {
        b.step(0.05);
        if (b.player.boarders().length) boarded = true;
        if (b.player.boarders().some((x) => x.task === 'fight')) repelled = true;
      }
    }
    expect(boarded).toBe(true);
    expect(repelled).toBe(true);
  });

  it('an auto-captain told to board takes prizes by boarding sometimes', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const foe = enemy('merchant');
      const b = new Battle(playerShip('wren'), foe.ship, { seed, autoPlayer: true, enemyAI: foe.ai, playerBoardWith: 2, allowEscape: false });
      kinds.add(b.runToEnd(900)?.kind ?? 'timeout');
    }
    expect(kinds.has('captured')).toBe(true);
  });

  it('is still reproducible from a seed', () => {
    const foe = enemy('privateer');
    const go = () => new Battle(playerShip('gull'), foe.ship, { seed: 9, autoPlayer: true, enemyAI: foe.ai, playerBoardWith: 2 }).runToEnd(600);
    expect(go()).toEqual(go());
  });
});
