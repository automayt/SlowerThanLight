import { describe, expect, it } from 'vitest';
import { playerShip } from '../../src/data/ships';
import { FIRE_CATCH, ignite, isSinking, updateHazards } from '../../src/sim/Hazards';
import { updateCrew } from '../../src/sim/Crew';
import { tileAt } from '../../src/sim/Ship';
import { Rng } from '../../src/sim/rng';
import { Ship } from '../../src/sim/Ship';

function run(ship: Ship, seconds: number, rng = new Rng(3)) {
  for (let t = 0; t < seconds; t += 0.05) updateHazards(ship, 0.05, rng, []);
}

function emptyShip(id = 'gull') {
  const ship = new Ship(playerShip(id), 'player');
  ship.crew = [];
  return ship;
}

describe('fire', () => {
  it('grows, damages the system and eventually spreads when left alone', () => {
    const ship = emptyShip();
    ship.room('guns').fire = 40;
    run(ship, 30);
    expect(ship.room('guns').fire).toBe(100);
    expect(ship.system('guns')!.damage).toBeGreaterThan(0);
    const burning = [...ship.rooms.values()].filter((r) => r.fire > 0).length;
    expect(burning).toBeGreaterThan(1);
  });

  it('a shot lights one tile, which creeps across the room before the room is ablaze', () => {
    const ship = emptyShip();
    const room = ship.room('guns');
    const events: { t: string }[] = [];
    ignite(ship, room, new Rng(1), 40, events as never, 0);
    expect(room.flames.filter((f) => f > 0)).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(room.fire).toBeLessThan(40);
    const counts: number[] = [];
    for (let s = 0; s < 6; s++) {
      run(ship, 3, new Rng(10 + s));
      counts.push(room.flames.filter((f) => f > 0).length);
    }
    // It takes hold tile by tile rather than all at once, and keeps growing.
    expect(counts[0]).toBeLessThan(room.flames.length);
    expect(counts.at(-1)!).toBeGreaterThan(counts[0]);
  });

  it('spreads from room to room a tile at a time, through doorways and now and then through bulkheads', () => {
    let spread = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const ship = emptyShip();
      ship.room('guns').fire = 100;
      const rng = new Rng(seed);
      for (let t = 0; t < 20; t += 0.05) {
        updateHazards(ship, 0.05, rng, []);
        const caught = [...ship.rooms.values()].filter((r) => r.def.id !== 'guns' && r.flames.some((f) => f > 0));
        if (!caught.length) continue;
        spread++;
        // The neighbour catches at a single tile, not all at once.
        for (const r of caught) expect(r.flames.filter((f) => f > 0)).toHaveLength(1);
        break;
      }
    }
    expect(spread).toBeGreaterThan(10);
  });

  it('newly caught tiles start small', () => {
    const ship = emptyShip();
    const room = ship.room('guns');
    ignite(ship, room, new Rng(1), FIRE_CATCH, [], 1);
    expect(room.flames[1]).toBe(FIRE_CATCH);
    expect(room.fire).toBe(FIRE_CATCH / room.flames.length);
  });

  it('burns the crew standing in the flames worse than those in the smoke', () => {
    const ship = new Ship(playerShip('gull'), 'player');
    const room = ship.room('guns');
    const inRoom = ship.crew.filter((c) => c.room === 'guns');
    if (!inRoom.length) return;
    const c = inRoom[0];
    room.flames[tileAt(room, c.pos)] = 100;
    const far = room.flames.length > 1 ? room.flames.findIndex((_, i) => i !== tileAt(room, c.pos)) : -1;
    const hp = c.hp;
    updateHazards(ship, 1, new Rng(1), []);
    const underfoot = hp - c.hp;
    room.fire = 0;
    if (far >= 0) {
      room.flames[far] = 100;
      const hp2 = c.hp;
      updateHazards(ship, 1, new Rng(1), []);
      expect(hp2 - c.hp).toBeLessThan(underfoot);
    }
    expect(underfoot).toBeGreaterThan(0);
  });

  it('firefighters beat down the flames nearest them first', () => {
    const ship = new Ship(playerShip('gull'), 'player');
    const room = ship.room('guns');
    const crew = ship.crew.filter((c) => c.room === 'guns');
    if (!crew.length || room.flames.length < 2) return;
    ship.crew = [crew[0]];
    const near = tileAt(room, crew[0].pos);
    const far = room.flames.reduce((best, _, i) => {
      const d = (j: number) => Math.abs((j % room.def.w) - (near % room.def.w)) + Math.abs(Math.floor(j / room.def.w) - Math.floor(near / room.def.w));
      return d(i) > d(best) ? i : best;
    }, near);
    room.flames[near] = 60;
    room.flames[far] = 60;
    updateCrew(ship, 0.5);
    expect(room.flames[near]).toBeLessThan(60);
    expect(room.flames[far]).toBe(60);
  });

  it('is put out by flooding', () => {
    const ship = emptyShip();
    ship.room('fore').fire = 60;
    ship.room('fore').water = 90;
    ship.addHands('pumps', -ship.system('pumps')!.hands);
    run(ship, 3);
    expect(ship.room('fore').fire).toBe(0);
  });
});

describe('flooding', () => {
  it('a breach floods the room and water spreads through doors', () => {
    const ship = emptyShip();
    while (ship.addHands('pumps', -1));
    ship.room('pumps').breach = true;
    run(ship, 10);
    expect(ship.room('pumps').water).toBeGreaterThan(20);
    expect(ship.room('quarters').water + ship.room('guns').water).toBeGreaterThan(5);
  });

  it('pumps drain water once the breach is patched', () => {
    const ship = emptyShip();
    ship.room('guns').water = 80;
    ship.addHands('sails', -1);
    while (ship.addHands('bulwarks', -1));
    while (ship.addHands('pumps', 1));
    expect(ship.level('pumps')).toBe(2);
    run(ship, 30);
    expect(ship.floodFraction()).toBeLessThan(0.01);
  });

  it('several unpatched breaches with no pumps sink the ship', () => {
    const ship = emptyShip('wren');
    while (ship.addHands('pumps', -1));
    for (const r of ship.rooms.values()) r.breach = true;
    expect(isSinking(ship)).toBe(false);
    run(ship, 20);
    expect(isSinking(ship)).toBe(true);
  });

  it('a swamped system stops working', () => {
    const ship = emptyShip();
    expect(ship.level('sails')).toBeGreaterThan(0);
    ship.room('sails').water = 60;
    expect(ship.level('sails')).toBe(0);
  });
});

describe('surgeon', () => {
  it('heals crew standing in the cabin', () => {
    const ship = new Ship(playerShip('gull'), 'player');
    while (ship.addHands('pumps', -1));
    while (ship.addHands('bulwarks', -1));
    ship.addHands('surgeon', 1);
    const c = ship.crew[0];
    c.room = 'surgeon';
    c.hp = 40;
    run(ship, 5);
    expect(c.hp).toBeGreaterThan(60);
  });
});
