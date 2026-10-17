import { describe, expect, it } from 'vitest';
import { ENEMY_LIST, MERCHANT_BRIG, NAVY_CUTTER } from '../../src/data/enemies';
import { PLAYER_SHIPS, playerShip } from '../../src/data/ships';
import { Battle, STEP } from '../../src/sim/Battle';
import { scaleEnemy } from '../../src/sim/Run';
import type { Ship } from '../../src/sim/Ship';

/** Everything that matters about a fight's state, without the per-process crew ids. */
function snapshot(b: Battle) {
  const ship = (s: Ship) => ({
    hull: s.hull,
    layers: s.layers,
    escape: s.escape,
    crew: s.crew.map(({ id: _id, ...c }) => c),
    rooms: [...s.rooms.values()].map(({ def: _def, ...r }) => r),
    systems: [...s.systems.values()],
    guns: s.guns.map(({ def, ...g }) => ({ ...g, weapon: def.id })),
  });
  return { time: b.time, outcome: b.outcome, player: ship(b.player), enemy: ship(b.enemy), transit: b.transit.map((t) => t.crew.name), stats: b.stats };
}

/** A captain's orders given at set moments of the fight: aim, change shot, man stations, board and recall. */
function scripted(seed: number): Battle {
  const b = new Battle(playerShip('wolf'), MERCHANT_BRIG, { seed, enemyAI: { fleeAt: 0, surrenderChance: 0, surrenderAt: 0 } });
  const orders: [number, () => void][] = [
    [0.5, () => b.player.guns.forEach((_, i) => b.aimGun(i, i % 2 ? 'helm' : 'sails'))],
    [3, () => b.setShot(0, 'chain')],
    [6, () => b.setBroadside(true)],
    [9, () => b.orderCrew(b.player.own().slice(3, 6).map((c) => c.id), 'hold', 'enemy')],
    [10, () => b.moveCrew(b.player.own()[0].id, 'sails')],
    [30, () => b.enemy.crew.filter((c) => c.side === 'player').forEach((c) => b.moveCrew(c.id, 'fore', 'player'))],
    [32, () => b.setBroadside(false)],
  ];
  while (!b.outcome && b.time < 300) {
    while (orders.length && b.time >= orders[0][0]) orders.shift()![1]();
    b.step(STEP);
  }
  return b;
}

describe('battle determinism', () => {
  it('the same seed and the same orders give the same fight, step for step', () => {
    const a = scripted(17);
    const b = scripted(17);
    expect(a.outcome).not.toBeNull();
    expect(snapshot(b)).toEqual(snapshot(a));
    // The orders really were carried out: a party went across and the chain shot was loaded.
    const events = a.drainEvents();
    expect(events.some((e) => e.t === 'board' && e.side === 'player')).toBe(true);
    expect(events.some((e) => e.t === 'shot' && e.side === 'player' && e.shot === 'chain')).toBe(true);
    expect(b.drainEvents()).toEqual(events);
  });

  it('a different seed gives a different fight', () => {
    expect(snapshot(scripted(18))).not.toEqual(snapshot(scripted(17)));
  });

  it('does not depend on the frame rate: real time is cut into fixed steps', () => {
    const fight = (fps: number) => {
      const b = new Battle(playerShip('gull'), NAVY_CUTTER, { seed: 9, autoPlayer: true });
      while (!b.outcome && b.time < 900) b.update(1 / fps);
      return snapshot(b);
    };
    const at60 = fight(60);
    expect(at60.outcome).not.toBeNull();
    expect(fight(144)).toEqual(at60);
    // A long hitch (a background tab) only advances a quarter second, never a burst of catch-up steps.
    expect(fight(2)).toEqual(at60);
  });

  it('an AI-captained fight replays exactly whatever the ships, sector or difficulty', () => {
    for (const def of PLAYER_SHIPS) {
      const foe = ENEMY_LIST[def.id.length % ENEMY_LIST.length];
      const make = () => new Battle(def, scaleEnemy(foe.ship, 2), { seed: 5, autoPlayer: true, enemyAI: foe.ai, enemyReload: 1.15, playerReload: 1.1, playerNets: true });
      const a = make();
      a.runToEnd(900);
      const b = make();
      b.runToEnd(900);
      expect(snapshot(b), `${def.id} v ${foe.id}`).toEqual(snapshot(a));
    }
  });
});

describe('every battle ends', () => {
  // Every ship against every enemy as found in every sector: the AI captains always reach a result, well inside
  // the 900 s autoRun allows before it calls a stalemate (the longest seen in 1200 such fights is about 410 s).
  for (const def of PLAYER_SHIPS) {
    it(`${def.id}: against every enemy in every sector`, () => {
      for (const foe of ENEMY_LIST) {
        for (const tier of [0, 1, 2]) {
          const b = new Battle(def, scaleEnemy(foe.ship, tier), { seed: 31 + tier, autoPlayer: true, enemyAI: foe.ai, allowEscape: foe.id !== 'frigate', boss: foe.id === 'frigate' });
          const outcome = b.runToEnd(900);
          expect(outcome, `${def.id} v ${foe.id} tier ${tier}`).not.toBeNull();
          expect(outcome!.time).toBeLessThan(600);
        }
      }
    });
  }
});
