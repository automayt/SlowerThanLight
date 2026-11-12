import { describe, expect, it } from 'vitest';
import { enemy, MERCHANT_BRIG, NAVY_CUTTER } from '../../src/data/enemies';
import { playerShip } from '../../src/data/ships';
import { Battle } from '../../src/sim/Battle';
import {
  BOARD_TIME,
  canGrapple,
  critChance,
  CRIT_CHANCE,
  CRIT_RANK,
  DEFENDER_BONUS,
  grappleSpeed,
  land,
  marksman,
  MELEE_DPS,
  parryChance,
  PARRY_CHANCE,
  PARRY_RANK,
  partyStrength,
  pistolChance,
  PISTOL_DAMAGE,
  SABOTAGE_RATE,
  updateBoarding,
} from '../../src/sim/Boarding';
import type { BattleEvent } from '../../src/sim/events';
import { Rng } from '../../src/sim/rng';
import { Ship, type Crew } from '../../src/sim/Ship';
import { RANK_XP } from '../../src/sim/Skills';

/** Run the battle for some seconds of game time (stops early if it ends). */
function run(b: Battle, seconds: number): void {
  for (let t = 0; t < seconds && !b.outcome; t += 0.05) b.step(0.05);
}

/**
 * A fight in one room of a ship of `def`: some of her crew against some of the Maw's (ordinary sailors), until one
 * side is down or a minute is up. Boarders have nowhere to run (no battle to send them home).
 */
function fight(boarders: number, defenders: number, def = NAVY_CUTTER, room = 'guns', seed = 1) {
  const ship = new Ship(def, 'enemy');
  const mine = ship.crew.slice(0, defenders);
  ship.crew = [];
  for (const c of mine) land(ship, c, room);
  const raiders = new Ship(playerShip('maw'), 'player').crew.slice(0, boarders);
  for (const c of raiders) land(ship, c, room);
  const rng = new Rng(seed);
  const events: BattleEvent[] = [];
  for (let t = 0; t < 60 && ship.own().some((c) => c.hp > 0) && raiders.some((c) => c.hp > 0); t += 0.05) {
    updateBoarding(ship, 0.05, events, { rng });
    ship.crew = ship.crew.filter((c) => c.hp > 0);
  }
  return { boardersLeft: raiders.filter((c) => c.hp > 0).length, defendersLeft: ship.own().length, events, ship, raiders };
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
    expect(fight(3, 1).defendersLeft).toBe(0);
    expect(fight(1, 2).boardersLeft).toBe(0);
    // One against one, a Navy defender usually wins; a merchant hand usually does not.
    const navy = Array.from({ length: 40 }, (_, i) => fight(1, 1, NAVY_CUTTER, 'guns', i + 1).defendersLeft).reduce((a, b) => a + b, 0);
    const merchant = Array.from({ length: 40 }, (_, i) => fight(1, 1, MERCHANT_BRIG, 'hold', i + 1).boardersLeft).reduce((a, b) => a + b, 0);
    expect(navy).toBeGreaterThan(24);
    expect(merchant).toBeGreaterThan(30);
  });

  it('unopposed boarders wreck the system in the room', () => {
    const ship = new Ship(MERCHANT_BRIG, 'enemy');
    ship.crew = ship.crew.filter((c) => c.room !== 'guns');
    const raiders = new Ship(playerShip('maw'), 'player').crew.slice(0, 2);
    for (const c of raiders) land(ship, c, 'guns');
    const events: BattleEvent[] = [];
    for (let t = 0; t < 100 / (SABOTAGE_RATE * 2) + 0.5; t += 0.05) updateBoarding(ship, 0.05, events, { rng: new Rng(1) });
    expect(ship.system('guns')!.damage).toBe(1);
    expect(raiders.every((c) => c.task === 'sabotage')).toBe(true);
    expect(events.some((e) => e.t === 'log')).toBe(true);
  });

  it('boarders landing in a full room spill into the nearest room with space', () => {
    const ship = new Ship(MERCHANT_BRIG, 'enemy');
    ship.crew = [];
    const raiders = [...new Ship(playerShip('maw'), 'player').crew, ...new Ship(playerShip('gull'), 'player').crew];
    const guns = ship.room('guns').def;
    const tiles = guns.w * guns.h;
    for (const c of raiders.slice(0, tiles)) land(ship, c, 'guns');
    const extra = raiders[tiles];
    land(ship, extra, 'guns');
    expect(extra.room).not.toBe('guns');
    const mid = (id: string) => {
      const d = ship.room(id).def;
      return { x: d.x + d.w / 2, y: d.y + d.h / 2 };
    };
    const dist = (id: string) => (mid(id).x - mid('guns').x) ** 2 + (mid(id).y - mid('guns').y) ** 2;
    const nearest = Math.min(...[...ship.rooms.keys()].filter((id) => id !== 'guns').map(dist));
    expect(dist(extra.room)).toBe(nearest);
  });

  it('defenders in the room stop the sabotage and fight instead', () => {
    const ship = new Ship(MERCHANT_BRIG, 'enemy');
    const raider = new Ship(playerShip('maw'), 'player').crew[0];
    land(ship, raider, 'guns');
    const rng = new Rng(1);
    for (let t = 0; t < 30; t += 0.05) updateBoarding(ship, 0.05, [], { rng });
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
      // A steady captain (a long-gun one never boards).
      const b = new Battle(playerShip('gull'), foe.ship, { seed, autoPlayer: true, enemyAI: { ...foe.ai, temper: 'steady' } });
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

describe('the melee, blow by blow', () => {
  /** Some of a merchant's crew and some of the Maw's standing in one room of the merchant, not yet fighting. */
  function room(boarders: number, defenders: number, roomId = 'hold') {
    const ship = new Ship(MERCHANT_BRIG, 'enemy');
    const mine = ship.crew.slice(0, defenders);
    ship.crew = [];
    for (const c of mine) land(ship, c, roomId);
    const raiders = new Ship(playerShip('maw'), 'player').crew.slice(0, boarders);
    for (const c of raiders) land(ship, c, roomId);
    for (const c of ship.crew) c.hp = c.maxHp = 1000;
    return { ship, defenders: mine, raiders };
  }
  const blows = (events: BattleEvent[]) => events.filter((e): e is Extract<BattleEvent, { t: 'blow' }> => e.t === 'blow');

  it('fighters pair off one on one, and extra hands gang up on whoever has fewest on him', () => {
    const rng = new Rng(1);
    const two = room(2, 2);
    updateBoarding(two.ship, 0.05, [], { rng });
    const [a, b] = two.raiders;
    const [x, y] = two.defenders;
    expect(new Set([a.foe, b.foe])).toEqual(new Set([x.id, y.id]));
    // Each pair faces each other.
    for (const c of two.ship.crew) expect(two.ship.crew.find((f) => f.id === c.foe)!.foe).toBe(c.id);

    const three = room(3, 2);
    updateBoarding(three.ship, 0.05, [], { rng });
    const on = (c: Crew) => three.raiders.filter((r) => r.foe === c.id).length;
    expect(three.defenders.map(on).sort()).toEqual([1, 2]);

    // Pairs hold while both stand; when a foe falls his opponent takes the next.
    const before = three.raiders.map((r) => r.foe);
    for (let i = 0; i < 20; i++) updateBoarding(three.ship, 0.05, [], { rng });
    expect(three.raiders.map((r) => r.foe)).toEqual(before);
    const victim = three.defenders[0];
    victim.hp = 0;
    three.ship.crew = three.ship.crew.filter((c) => c.hp > 0);
    updateBoarding(three.ship, 0.05, [], { rng });
    expect(three.raiders.every((r) => r.foe === three.defenders[1].id)).toBe(true);
  });

  it('every fighter opens with one pistol shot, then steel; out of the fight the pistol is loaded again', () => {
    const { ship, raiders, defenders } = room(2, 2);
    const rng = new Rng(4);
    const events: BattleEvent[] = [];
    for (let t = 0; t < 12; t += 0.05) updateBoarding(ship, 0.05, events, { rng });
    for (const c of ship.crew) {
      const mine = blows(events).filter((e) => e.from === c.id);
      expect(mine.filter((e) => e.kind === 'shot' || e.kind === 'miss')).toHaveLength(1);
      expect(mine[0].kind === 'shot' || mine[0].kind === 'miss').toBe(true);
      expect(mine.length).toBeGreaterThan(5);
    }
    // A pistol ball that hits is a solid chunk; one that misses does nothing.
    for (const e of blows(events)) if (e.kind === 'shot') expect(e.dmg).toBe(PISTOL_DAMAGE);
    for (const e of blows(events)) if (e.kind === 'miss' || e.kind === 'parry') expect(e.dmg).toBe(0);
    // Every defender walks out and the room is quiet; back in, everyone fires again.
    ship.crew = ship.crew.filter((c) => !defenders.includes(c));
    updateBoarding(ship, 0.05, [], { rng });
    expect(raiders.every((c) => c.foe === undefined && !c.fired)).toBe(true);
    for (const c of defenders) land(ship, c, 'hold');
    const again: BattleEvent[] = [];
    for (let t = 0; t < 2; t += 0.05) updateBoarding(ship, 0.05, again, { rng });
    expect(blows(again).filter((e) => e.kind === 'shot' || e.kind === 'miss').length).toBe(4);
  });

  it('marines are better shots', () => {
    const ship = new Ship(NAVY_CUTTER, 'enemy');
    const marine = ship.crew.find((c) => c.name.startsWith('Marine'))!;
    const gunner = ship.crew.find((c) => c.name.startsWith('Gunner'))!;
    expect(marksman(marine)).toBe(true);
    expect(marksman(gunner)).toBe(false);
    expect(pistolChance(marine)).toBeGreaterThan(pistolChance(gunner));
  });

  it('brawling rank parries more blows and lands more heavy ones', () => {
    const odds = (attackerXp: number, defenderXp: number) => {
      const { ship, raiders, defenders } = room(1, 1);
      raiders[0].xp.combat = attackerXp;
      defenders[0].xp.combat = defenderXp;
      for (const c of ship.crew) c.hp = c.maxHp = 1e9;
      const rng = new Rng(7);
      const events: BattleEvent[] = [];
      for (let t = 0; t < 600; t += 0.05) {
        updateBoarding(ship, 0.05, events, { rng });
        raiders[0].xp.combat = attackerXp; // (fighting teaches: keep him at the rank under test)
      }
      const steel = blows(events).filter((e) => e.from === raiders[0].id && e.kind !== 'shot' && e.kind !== 'miss');
      return { parry: steel.filter((e) => e.kind === 'parry').length / steel.length, crit: steel.filter((e) => e.kind === 'crit').length / steel.length, n: steel.length };
    };
    const green = odds(0, 0);
    expect(green.parry).toBeCloseTo(PARRY_CHANCE, 1);
    expect(green.crit).toBeCloseTo(CRIT_CHANCE, 1);
    // An Expert defender turns more aside; an Expert attacker lands more heavy blows, and swings faster.
    expect(odds(0, RANK_XP[2]).parry).toBeGreaterThan(green.parry + 0.08);
    const expert = odds(RANK_XP[2], 0);
    expect(expert.crit).toBeGreaterThan(green.crit + 0.07);
    expect(expert.n).toBeGreaterThan(green.n);
    expect(parryChance({ xp: { combat: RANK_XP[1] } } as Crew)).toBeCloseTo(PARRY_CHANCE + PARRY_RANK);
    expect(critChance({ xp: { combat: RANK_XP[2] } } as Crew)).toBeCloseTo(CRIT_CHANCE + 2 * CRIT_RANK);
  });

  it('keeps the old pace: on average a green fighter deals about MELEE_DPS times his strength a second', () => {
    const { ship, raiders } = room(1, 1);
    for (const c of ship.crew) c.hp = c.maxHp = 1e9;
    const rng = new Rng(11);
    const events: BattleEvent[] = [];
    const T = 1200;
    for (let t = 0; t < T; t += 0.05) {
      updateBoarding(ship, 0.05, events, { rng });
      raiders[0].xp = {};
    }
    const dealt = blows(events).filter((e) => e.from === raiders[0].id && e.kind !== 'shot').reduce((n, e) => n + e.dmg, 0);
    expect(dealt / T).toBeCloseTo(MELEE_DPS * raiders[0].melee, 0);
  });

  it('brawlers learn by fighting', () => {
    const { ship, raiders } = room(1, 1);
    const rng = new Rng(2);
    for (let t = 0; t < 10; t += 0.05) updateBoarding(ship, 0.05, [], { rng });
    expect(raiders[0].xp.combat).toBeGreaterThan(9);
  });

  it('replays exactly from the same seed', () => {
    const go = () => blows(fight(3, 3, NAVY_CUTTER, 'guns', 21).events).map((e) => `${e.kind}:${e.dmg}`);
    expect(go()).toEqual(go());
  });
});

describe('morale', () => {
  /** A quiet battle with a captain who won't board on his own account, and every gun silent. */
  function calm(seed = 3): Battle {
    const b = new Battle(playerShip('maw'), MERCHANT_BRIG, { seed, enemyAI: { fleeAt: 0, surrenderChance: 0, surrenderAt: 0, temper: 'steady' } });
    for (const g of [...b.player.guns, ...b.enemy.guns]) g.powered = g.wanted = false;
    return b;
  }

  /** Step until `stop` says so (or `seconds` pass), collecting the events. */
  function until(b: Battle, seconds: number, stop: (e: BattleEvent[]) => boolean): BattleEvent[] {
    const all: BattleEvent[] = [];
    for (let t = 0; t < seconds && !b.outcome; t += 0.05) {
      b.step(0.05);
      all.push(...b.drainEvents());
      if (stop(all)) break;
    }
    return all;
  }

  /** The player room with the most of her own crew in it. */
  function crowded(b: Battle): string {
    const count = (id: string) => b.player.own().filter((c) => c.room === id).length;
    return [...b.player.rooms.keys()].sort((x, y) => count(y) - count(x))[0];
  }

  it('beaten boarders break and run for their own ship', () => {
    const b = calm();
    const target = crowded(b);
    const party = b.enemy.own().filter((c) => c.room !== b.enemy.system('helm')!.room).slice(0, 2);
    for (const c of party) c.hp = c.maxHp = 1000;
    b.board('enemy', party, target);
    run(b, BOARD_TIME + 0.3);
    expect(b.player.boarders()).toHaveLength(2);
    // One of them falls: the other, alone against our crew, loses his nerve.
    party[0].hp = 0;
    const events = until(b, 20, (e) => e.some((x) => x.t === 'rout'));
    expect(events.find((e) => e.t === 'rout')).toMatchObject({ side: 'player', room: target, broke: 'enemy', count: 1 });
    expect(events.some((e) => e.t === 'log' && e.text === `${b.enemy.def.name}'s boarders break and run!`)).toBe(true);
    const tr = b.transit.find((t) => t.crew === party[1]);
    expect(tr?.to).toBe('enemy');
    expect(party[1].shaken).toBeGreaterThan(0);
    run(b, BOARD_TIME + 0.2);
    expect(b.enemy.crew).toContain(party[1]);
  });

  it('beaten defenders break and fall back to another room', () => {
    const b = calm();
    const hold = 'hold';
    const helm = b.enemy.system('helm')!.room;
    const defenders = b.enemy.own().filter((c) => c.home !== helm).slice(0, 2);
    // Nobody else of hers comes to help: her helmsman too hurt to fight, the rest gone.
    b.enemy.crew = b.enemy.crew.filter((c) => defenders.includes(c) || c.home === helm);
    for (const c of b.enemy.own()) if (c.home === helm) c.hp = 25;
    for (const c of defenders) {
      b.enemy.crew = b.enemy.crew.filter((x) => x !== c);
      land(b.enemy, c, hold);
      c.home = hold;
      c.hp = c.maxHp = 1000;
    }
    const party = b.player.own().slice(1, 4);
    b.board('player', party, hold);
    run(b, BOARD_TIME + 0.3);
    defenders[0].hp = 0;
    const events = until(b, 20, (e) => e.some((x) => x.t === 'rout'));
    expect(events.find((e) => e.t === 'rout')).toMatchObject({ side: 'enemy', room: hold, broke: 'enemy' });
    const runner = defenders[1];
    expect(runner.waypoints.length).toBeGreaterThan(0);
    expect(runner.waypoints[runner.waypoints.length - 1].room).not.toBe(hold);
    expect(runner.shaken).toBeGreaterThan(0);
  });

  it('nobody breaks beside an Expert brawler', () => {
    const b = calm();
    const target = crowded(b);
    const party = b.enemy.own().filter((c) => c.room !== b.enemy.system('helm')!.room).slice(0, 3);
    for (const c of party) c.hp = c.maxHp = 1e6;
    party[1].xp.combat = RANK_XP[2];
    b.board('enemy', party, target);
    run(b, BOARD_TIME + 0.3);
    party[0].hp = 0;
    party[2].hp = 0;
    const events = until(b, 25, (e) => e.some((x) => x.t === 'rout'));
    expect(events.some((e) => e.t === 'rout')).toBe(false);
    expect(b.player.boarders()).toEqual([party[1]]);
  });

  it('defenders with nowhere left to run fight on', () => {
    const ship = new Ship(MERCHANT_BRIG, 'enemy');
    const [a, d] = ship.crew;
    ship.crew = [];
    land(ship, a, 'hold');
    land(ship, d, 'hold');
    const raiders = [...new Ship(playerShip('maw'), 'player').crew, ...new Ship(playerShip('maw'), 'player').crew];
    // Our people hold every other room, and three of them are in the hold.
    const others = [...ship.rooms.keys()].filter((id) => id !== 'hold');
    others.forEach((id, i) => land(ship, raiders[i], id));
    for (const c of raiders.slice(others.length, others.length + 3)) land(ship, c, 'hold');
    for (const c of ship.crew) c.hp = c.maxHp = 1e6;
    a.hp = 0;
    const rng = new Rng(5);
    const events: BattleEvent[] = [];
    for (let t = 0; t < 30; t += 0.05) {
      updateBoarding(ship, 0.05, events, { rng });
      ship.crew = ship.crew.filter((c) => c.hp > 0);
    }
    expect(events.some((e) => e.t === 'rout')).toBe(false);
    expect(d.room).toBe('hold');
    expect(d.task).toBe('fight');
  });
});
