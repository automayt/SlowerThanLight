import { describe, expect, it } from 'vitest';
import { ENEMY_LIST, NAVY_CUTTER } from '../../src/data/enemies';
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

  it('cannot escape a fight that allows no escape', () => {
    const battle = new Battle(playerShip('wren'), NAVY_CUTTER, { seed: 5, allowEscape: false });
    for (let i = 0; i < 2400 && !battle.outcome; i++) battle.step(0.05);
    expect(battle.player.escape).toBe(0);
    expect(battle.escape()).toBe(false);
  });

  it('starts with the damage the player brought in', () => {
    const def = playerShip('gull');
    const battle = new Battle(def, NAVY_CUTTER, { seed: 1, playerCondition: { hull: 9, crew: [{ name: 'Lone Wolf', hp: 50, home: 'helm' }], damage: { guns: 1 } } });
    expect(battle.player.hull).toBe(9);
    expect(battle.player.crew.map((c) => c.name)).toEqual(['Lone Wolf']);
    expect(battle.player.system('guns')!.damage).toBe(1);
  });

  for (const foe of ENEMY_LIST) {
    it(`${foe.id}: fights to an end against an AI-captained brigantine`, () => {
      const battle = new Battle(playerShip('gull'), foe.ship, { seed: 11, autoPlayer: true, enemyAI: foe.ai });
      expect(battle.runToEnd(900)).not.toBeNull();
    });
  }
});
