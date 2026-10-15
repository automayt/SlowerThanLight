import { describe, expect, it } from 'vitest';
import { NAVY_CUTTER } from '../../src/data/enemies';
import { PLAYER_SHIPS, playerShip } from '../../src/data/ships';
import { Battle } from '../../src/sim/Battle';

describe('battle', () => {
  it('is reproducible from a seed', () => {
    const a = new Battle(playerShip('gull'), NAVY_CUTTER, { seed: 42, autoPlayer: true }).runToEnd();
    const b = new Battle(playerShip('gull'), NAVY_CUTTER, { seed: 42, autoPlayer: true }).runToEnd();
    expect(a).toEqual(b);
  });

  for (const def of PLAYER_SHIPS) {
    it(`${def.id}: an AI-captained ship fights to a decisive end`, () => {
      const battle = new Battle(def, NAVY_CUTTER, { seed: 7, autoPlayer: true });
      const outcome = battle.runToEnd(600);
      expect(outcome).not.toBeNull();
      expect(battle.stats.player.shotsFired).toBeGreaterThan(0);
      expect(battle.stats.enemy.shotsFired).toBeGreaterThan(0);
    });
  }

  it('an idle player with no aim loses or is escaped from', () => {
    const battle = new Battle(playerShip('wren'), NAVY_CUTTER, { seed: 3 });
    const outcome = battle.runToEnd(900);
    expect(outcome?.won).toBe(false);
  });

  it('the player can escape once Make Sail is charged', () => {
    const battle = new Battle(playerShip('wren'), NAVY_CUTTER, { seed: 5 });
    expect(battle.escape()).toBe(false);
    while (!battle.canEscape() && !battle.outcome) battle.step(0.05);
    expect(battle.escape()).toBe(true);
    expect(battle.outcome?.kind).toBe('escaped');
  });

  it('pausing stops time', () => {
    const battle = new Battle(playerShip('wren'), NAVY_CUTTER, { seed: 1 });
    battle.togglePause();
    battle.update(0.2);
    expect(battle.time).toBe(0);
    battle.togglePause();
    battle.update(0.2);
    expect(battle.time).toBeGreaterThan(0);
  });
});
