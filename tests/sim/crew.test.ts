import { describe, expect, it } from 'vitest';
import { playerShip } from '../../src/data/ships';
import { orderMove, updateCrew } from '../../src/sim/Crew';
import { Ship } from '../../src/sim/Ship';

function run(ship: Ship, seconds: number) {
  for (let t = 0; t < seconds; t += 0.05) updateCrew(ship, 0.05);
}

describe('crew', () => {
  it('walks to another room through doors and arrives in a free tile', () => {
    const ship = new Ship(playerShip('wren'), 'player');
    const anne = ship.crew.find((c) => c.room === 'helm')!;
    expect(orderMove(ship, anne, 'fore')).toBe(true);
    run(ship, 1);
    expect(anne.room).not.toBe('fore');
    run(ship, 5);
    expect(anne.room).toBe('fore');
    expect(anne.waypoints).toHaveLength(0);
    const f = ship.room('fore').def;
    expect(anne.pos.x).toBeGreaterThan(f.x);
    expect(anne.pos.x).toBeLessThan(f.x + f.w);
  });

  it('refuses to move into a full room', () => {
    const ship = new Ship(playerShip('wren'), 'player');
    // The forecastle has 2 tiles.
    const [a, b, c] = ship.crew;
    expect(orderMove(ship, a, 'fore')).toBe(true);
    expect(orderMove(ship, b, 'fore')).toBe(true);
    expect(orderMove(ship, c, 'fore')).toBe(false);
  });

  it('mans the helm, then puts out a fire before anything else', () => {
    const ship = new Ship(playerShip('wren'), 'player');
    run(ship, 0.1);
    expect(ship.isManned('helm')).toBe(true);
    expect(ship.evasion()).toBeGreaterThan(0);

    ship.room('helm').fire = 50;
    ship.damageSystem('helm', 1);
    run(ship, 0.1);
    expect(ship.crew.find((c) => c.room === 'helm')!.task).toBe('fire');
    expect(ship.isManned('helm')).toBe(false);
    expect(ship.evasion()).toBe(0);
    run(ship, 4);
    expect(ship.room('helm').fire).toBe(0);
    run(ship, 6);
    expect(ship.system('helm')!.damage).toBe(0);
    expect(ship.isManned('helm')).toBe(true);
  });

  it('patches a breach', () => {
    const ship = new Ship(playerShip('wren'), 'player');
    ship.room('pumps').breach = true;
    run(ship, 4.1);
    expect(ship.room('pumps').breach).toBe(false);
  });
});
