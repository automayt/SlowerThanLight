import { describe, expect, it } from 'vitest';
import { ENEMIES, ENEMY_LIST } from '../../src/data/enemies';
import { PLAYER_SHIPS, playerShip } from '../../src/data/ships';
import { Battle, STEP } from '../../src/sim/Battle';
import { BULWARK_RECHARGE, updateBulwarks } from '../../src/sim/Combat';
import { updateCrew } from '../../src/sim/Crew';
import { buildDoors, findRoute } from '../../src/sim/pathfinding';
import { scaleEnemy } from '../../src/sim/Run';
import { Ship } from '../../src/sim/Ship';

describe('ship data', () => {
  for (const def of [...PLAYER_SHIPS, ...ENEMY_LIST.map((e) => e.ship)]) {
    it(`${def.id}: every room is reachable from the helm`, () => {
      const doors = buildDoors(def.rooms);
      for (const r of def.rooms) expect(findRoute(doors, 'helm', r.id), r.id).not.toBeNull();
    });

    it(`${def.id}: rooms do not overlap`, () => {
      const seen = new Set<string>();
      for (const r of def.rooms) {
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) {
            const k = `${x},${y}`;
            expect(seen.has(k), `${r.id} overlaps at ${k}`).toBe(false);
            seen.add(k);
          }
        }
      }
    });

    it(`${def.id}: builds with every gun powered at start`, () => {
      const ship = new Ship(def, 'player');
      expect(ship.freeHands()).toBeGreaterThanOrEqual(0);
      expect(ship.crew).toHaveLength(def.crew.length);
      expect(ship.guns.every((g) => g.powered), 'her guns need more hands than her gun deck holds').toBe(true);
    });
  }

  for (const e of ENEMY_LIST) {
    it(`${e.id}: a captain who boards has the crew to do it`, () => {
      // EnemyAI only sends a party while it leaves at least three hands aboard.
      if (e.ai.boardWith) expect(e.ship.crew.length).toBeGreaterThanOrEqual(e.ai.boardWith + 3);
    });
  }

  it('every enemy of every sector can crew all her guns', () => {
    for (const e of ENEMY_LIST) {
      for (const tier of [0, 1, 2]) {
        const def = scaleEnemy(e.ship, tier);
        const ship = new Ship(def, 'enemy');
        expect(ship.guns.every((g) => g.powered), `${e.id} tier ${tier}`).toBe(true);
      }
    }
  });
});

describe('enemy boarders', () => {
  it('the corsair sends a boarding party across', () => {
    const corsair = ENEMIES.corsair;
    let boarded = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const b = new Battle(playerShip('gull'), corsair.ship, { seed, enemyAI: corsair.ai, allowEscape: false });
      while (!b.outcome && b.time < 120 && !b.player.boarders().length) b.step(STEP);
      if (b.player.boarders().length) boarded++;
    }
    expect(boarded).toBeGreaterThan(0);
  });
});

describe('bulwarks', () => {
  it('can be manned, and a manned station rebuilds faster', () => {
    const ship = new Ship(playerShip('wren'), 'player');
    updateCrew(ship, 0);
    // Jem Sparrow's station is the forecastle.
    expect(ship.isManned('bulwarks')).toBe(true);
    const bare = new Ship(playerShip('wren'), 'player');
    bare.crew = bare.crew.filter((c) => c.room !== 'fore');
    updateCrew(bare, 0);
    expect(bare.isManned('bulwarks')).toBe(false);
    for (const s of [ship, bare]) {
      s.layers = 0;
      updateBulwarks(s, BULWARK_RECHARGE * 0.85);
    }
    expect(ship.layers).toBe(1);
    expect(bare.layers).toBe(0);
  });
});

describe('hands', () => {
  it('cannot assign more hands than are free', () => {
    const ship = new Ship(playerShip('gull'), 'player');
    while (ship.addHands('surgeon', 1));
    expect(ship.freeHands()).toBe(0);
    expect(ship.addHands('surgeon', 1)).toBe(false);
  });

  it('system damage takes hands off and depowers guns', () => {
    const ship = new Ship(playerShip('gull'), 'player');
    expect(ship.guns.every((g) => g.powered)).toBe(true);
    ship.damageSystem('guns', 2);
    expect(ship.allocated('guns')).toBeLessThanOrEqual(ship.capacity('guns'));
    expect(ship.guns[2].powered).toBe(false);

    ship.damageSystem('sails', 3);
    expect(ship.level('sails')).toBe(0);
  });
});

describe('routes', () => {
  it('walks through the mainmast to reach the gun deck from the helm', () => {
    const doors = buildDoors(playerShip('wren').rooms);
    const route = findRoute(doors, 'helm', 'guns')!;
    expect(route.map((d) => d.b)).toEqual(['sails', 'guns']);
  });
});

describe('repairs', () => {
  it('re-powers guns and hands the captain wanted once the system is repaired', () => {
    const ship = new Ship(playerShip('gull'), 'player');
    const sailsBefore = ship.allocated('sails');
    ship.damageSystem('guns', 4);
    ship.damageSystem('sails', 3);
    expect(ship.guns.some((g) => g.powered)).toBe(false);
    expect(ship.allocated('sails')).toBe(0);

    const guns = ship.system('guns')!;
    const sails = ship.system('sails')!;
    guns.damage = 0;
    sails.damage = 0;
    ship.restoreWanted();
    expect(ship.guns.every((g) => g.powered)).toBe(true);
    expect(ship.allocated('sails')).toBe(sailsBefore);
  });

  it('does not re-power a gun the captain switched off', () => {
    const ship = new Ship(playerShip('gull'), 'player');
    ship.toggleGun(0, false);
    ship.damageSystem('guns', 4);
    ship.system('guns')!.damage = 0;
    ship.restoreWanted();
    expect(ship.guns[0].powered).toBe(false);
  });
});

describe('condition', () => {
  it('a fresh ship reports full hull, full crew and no damage', () => {
    const def = playerShip('gull');
    const c = new Ship(def, 'player').condition();
    expect(c.hull).toBe(def.hull);
    expect(c.crew.map((x) => x.name)).toEqual(def.crew.map((x) => x.name));
    expect(c.crew.every((x) => x.hp === 100)).toBe(true);
    expect(c.damage).toEqual({});
  });

  it('carries hull, wounds, losses and system damage into a new ship', () => {
    const def = playerShip('gull');
    const a = new Ship(def, 'player');
    a.hull = 11;
    a.crew[1].hp = 40;
    a.crew.pop();
    a.damageSystem('sails', 2);

    const b = new Ship(def, 'player', a.condition());
    expect(b.hull).toBe(11);
    expect(b.crew).toHaveLength(def.crew.length - 1);
    expect(b.crew[1].hp).toBe(40);
    expect(b.system('sails')!.damage).toBe(2);
    expect(b.allocated('sails')).toBeLessThanOrEqual(b.capacity('sails'));
  });

  it('finds a bunk for hired crew whose station is unknown', () => {
    const def = playerShip('wren');
    const cond = new Ship(def, 'player').condition();
    cond.crew.push({ name: 'New Hand', hp: 100, home: 'nowhere' });
    const ship = new Ship(def, 'player', cond);
    const hired = ship.crew.find((c) => c.name === 'New Hand')!;
    expect(ship.rooms.has(hired.room)).toBe(true);
  });
});

describe('carried damage', () => {
  it('re-crews guns and sails once damage brought into a fight is repaired', () => {
    const def = playerShip('gull');
    const fresh = new Ship(def, 'player');
    const cond = fresh.condition();
    cond.damage = { guns: 2, sails: 2 };
    const ship = new Ship(def, 'player', cond);
    expect(ship.allocated('guns')).toBeLessThanOrEqual(ship.capacity('guns'));
    ship.system('guns')!.damage = 0;
    ship.system('sails')!.damage = 0;
    ship.restoreWanted();
    expect(ship.allocated('guns')).toBe(fresh.allocated('guns'));
    expect(ship.allocated('sails')).toBe(fresh.allocated('sails'));
  });

  it('never remembers a survivor at 0 HP', () => {
    const ship = new Ship(playerShip('gull'), 'player');
    ship.crew[0].hp = 0.3;
    expect(ship.condition().crew[0].hp).toBe(1);
  });
});
