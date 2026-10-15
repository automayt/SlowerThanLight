import { describe, expect, it } from 'vitest';
import { playerShip } from '../../src/data/ships';
import { updateHazards, isSinking } from '../../src/sim/Hazards';
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
    ship.addHands('surgeon', 1);
    const c = ship.crew[0];
    c.room = 'surgeon';
    c.hp = 40;
    run(ship, 5);
    expect(c.hp).toBeGreaterThan(60);
  });
});
