import { describe, expect, it } from 'vitest';
import { ENEMY_LIST, NAVY_CUTTER } from '../../src/data/enemies';
import { PLAYER_SHIPS, playerShip } from '../../src/data/ships';
import { Battle, gunLoadRate } from '../../src/sim/Battle';
import { UNCREWED_RELOAD } from '../../src/sim/Combat';

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
    battle.player.escape = 99;
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

describe('opening stations', () => {
  it('spare hands are sent to an empty helm, gun deck and mainmast before the first shot', () => {
    // Everyone bunked at the helm (fresh hires land in the first free room) and nobody at the guns or sails.
    const crew = ['A', 'B', 'C', 'D'].map((name) => ({ name, hp: 100, home: 'helm' }));
    const battle = new Battle(playerShip('gull'), NAVY_CUTTER, { seed: 1, playerCondition: { hull: 20, crew, damage: {} } });
    for (const id of ['helm', 'guns', 'sails'] as const) expect(battle.player.isManned(id)).toBe(true);
    // The move sticks: they keep the new station into the next fight.
    const homes = battle.player.condition().crew.map((c) => c.home);
    expect(homes).toEqual(expect.arrayContaining(['helm', 'guns', 'sails']));
  });

  it('idle crew in a room with no station go to the empty one; a lone station-keeper stays put', () => {
    const crew = [
      { name: 'Helmsman', hp: 100, home: 'helm' },
      { name: 'Surgeon', hp: 100, home: 'surgeon' },
      { name: 'Idler', hp: 100, home: 'quarters' },
    ];
    const battle = new Battle(playerShip('gull'), NAVY_CUTTER, { seed: 1, playerCondition: { hull: 20, crew, damage: {} } });
    const at = (name: string) => battle.player.crew.find((c) => c.name === name)!.room;
    expect(at('Helmsman')).toBe('helm');
    expect(at('Surgeon')).toBe('surgeon');
    expect(at('Idler')).toBe('guns');
  });
});

describe('gun load rate', () => {
  it('matches how fast the guns actually load', () => {
    const battle = new Battle(playerShip('gull'), NAVY_CUTTER, { seed: 1, playerReload: 1.1 });
    for (const g of battle.enemy.guns) g.powered = false;
    battle.step(0.05);
    const gun = battle.player.guns.find((g) => g.powered)!;
    const rate = gunLoadRate(battle.player);
    const before = gun.charge;
    battle.step(0.05);
    expect(gun.charge - before).toBeCloseTo(rate * 0.05, 6);
    // Without anyone at the helm she can't bring her guns to bear; without a gun crew they load slowly.
    battle.player.crew = battle.player.crew.filter((c) => c.room !== 'helm' && c.room !== 'guns');
    expect(gunLoadRate(battle.player)).toBeCloseTo(UNCREWED_RELOAD * 0.5 * 1.1, 6);
  });
});

describe('the blockade', () => {
  it('the boss rallies once when low: repairs and loads faster', () => {
    const frigate = ENEMY_LIST.find((e) => e.id === 'frigate')!;
    const battle = new Battle(playerShip('maw'), frigate.ship, { seed: 2, boss: true, allowEscape: false });
    battle.enemy.damageSystem('guns', 3);
    battle.enemy.hull = Math.floor(frigate.ship.hull * 0.4);
    const reload = battle.enemy.reloadRate;
    battle.step(0.05);
    expect(battle.rallied).toBe(true);
    expect(battle.enemy.system('guns')!.damage).toBe(0);
    expect(battle.enemy.reloadRate).toBeGreaterThan(reload);
    expect(battle.drainEvents().some((e) => e.t === 'rally')).toBe(true);
    const again = battle.enemy.reloadRate;
    battle.step(0.05);
    expect(battle.enemy.reloadRate).toBe(again);
  });
});
