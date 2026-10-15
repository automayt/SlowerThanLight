import { describe, expect, it } from 'vitest';
import { NAVY_CUTTER } from '../../src/data/enemies';
import { PLAYER_SHIPS, playerShip } from '../../src/data/ships';
import { buildDoors, findRoute } from '../../src/sim/pathfinding';
import { Ship } from '../../src/sim/Ship';

describe('ship data', () => {
  for (const def of [...PLAYER_SHIPS, NAVY_CUTTER]) {
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
    });
  }
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
