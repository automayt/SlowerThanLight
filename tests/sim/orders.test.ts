import { describe, expect, it } from 'vitest';
import { MERCHANT_BRIG, NAVY_CUTTER } from '../../src/data/enemies';
import { playerShip } from '../../src/data/ships';
import { Battle, STEP } from '../../src/sim/Battle';
import { BOARD_TIME, land, NET_DAMAGE } from '../../src/sim/Boarding';
import { destination } from '../../src/sim/Crew';
import { ShipAI } from '../../src/sim/EnemyAI';
import { Rng } from '../../src/sim/rng';
import { Ship } from '../../src/sim/Ship';

const CALM = { fleeAt: 0, surrenderChance: 0, surrenderAt: 0 };

/** A fight where nobody shoots, for testing orders. */
function quiet(seed = 1): Battle {
  const b = new Battle(playerShip('wolf'), MERCHANT_BRIG, { seed, enemyAI: CALM });
  for (const g of [...b.player.guns, ...b.enemy.guns]) g.powered = g.wanted = false;
  return b;
}

function run(b: Battle, seconds: number): void {
  for (let t = 0; t < seconds && !b.outcome; t += STEP) b.step(STEP);
}

describe("the captain's orders", () => {
  it('send a crew member to another room of her own ship, and refuse rooms that do not exist', () => {
    const b = quiet();
    const c = b.player.crew[0];
    expect(b.moveCrew(c.id, 'guns')).toBe(true);
    expect(destination(c)).toBe('guns');
    expect(b.moveCrew(c.id, 'crow-nest')).toBe(false);
    expect(b.moveCrew(-1, 'guns')).toBe(false);
    run(b, 10);
    expect(c.room).toBe('guns');
  });

  it('send a whole party across together, and walk boarders already aboard to another of her rooms', () => {
    const b = quiet();
    const party = b.player.own().slice(1, 4);
    expect(b.orderCrew(party.map((c) => c.id), 'hold', 'enemy')).toBe(3);
    const boards = b.drainEvents().filter((e) => e.t === 'board');
    expect(boards).toEqual([{ t: 'board', side: 'player', count: 3, room: 'hold' }]);
    run(b, BOARD_TIME + 0.1);
    expect(party.every((c) => b.enemy.crew.includes(c))).toBe(true);
    // Once aboard her, an order to another of her rooms is a walk, not a second crossing.
    expect(b.orderCrew([party[0].id], 'sails', 'enemy')).toBe(1);
    expect(b.transit).toHaveLength(0);
    expect(destination(party[0])).toBe('sails');
    // And an order back to your own deck brings them home.
    expect(b.orderCrew(party.map((c) => c.id), 'quarters', 'player')).toBe(3);
    expect(b.transit).toHaveLength(3);
  });

  it('no boarding a ship that can out-sail you, and no orders once the fight is over', () => {
    const b = quiet();
    b.enemy.system('sails')!.hands = 9;
    b.enemy.system('sails')!.max = 9;
    expect(b.canBoard()).toBe(false);
    const c = b.player.crew[1];
    expect(b.moveCrew(c.id, 'hold', 'enemy')).toBe(false);
    expect(b.orderCrew([c.id], 'hold', 'enemy')).toBe(0);
    for (const e of b.enemy.own()) e.hp = 0;
    b.step(STEP);
    expect(b.outcome?.kind).toBe('captured');
    expect(b.moveCrew(c.id, 'guns')).toBe(false);
  });

  it('a crew member cannot be sent across twice, nor recalled when not away', () => {
    const b = quiet();
    const c = b.player.crew[1];
    expect(b.board('player', [c], 'hold')).toBe(1);
    expect(b.board('player', [c], 'hold')).toBe(0);
    expect(b.board('enemy', [c], 'helm')).toBe(0);
    expect(b.recall('player', b.player.crew[0])).toBe(false);
    expect(b.shipOf(c)).toBeNull();
  });

  it('hands, guns, aim and shot go where they are told, and nowhere that does not exist', () => {
    const b = quiet();
    expect(b.toggleGun(0)).toBe(true);
    expect(b.player.guns[0].powered).toBe(true);
    expect(b.toggleGun(9)).toBe(false);
    expect(b.addHands('helm', 1)).toBe(false);
    b.aimGun(0, 'hold');
    b.aimGun(0, 'crow-nest');
    b.aimGun(7, 'hold');
    expect(b.player.guns[0].target).toBe('hold');
    b.aimGun(0, null);
    expect(b.player.guns[0].target).toBeNull();
    b.setShot(0, 'grape');
    b.setShot(7, 'grape');
    expect(b.player.guns[0].shot).toBe('grape');
  });

  it('nothing moves after the fight is over', () => {
    const b = quiet();
    b.player.crew.forEach((c) => (c.hp = 0));
    b.step(STEP);
    expect(b.outcome?.kind).toBe('crewLost');
    const t = b.time;
    b.step(STEP);
    b.update(1);
    expect(b.time).toBe(t);
  });
});

describe('how a fight can end', () => {
  it('a ship full of water founders: hers is a victory, yours a loss', () => {
    const b = quiet();
    for (const r of b.enemy.rooms.values()) r.water = 100;
    b.step(STEP);
    expect(b.outcome).toMatchObject({ kind: 'enemySunk', won: true });

    const c = quiet();
    for (const r of c.player.rooms.values()) r.water = 100;
    c.step(STEP);
    expect(c.outcome).toMatchObject({ kind: 'sunk', won: false });
  });

  it('when both ships go down at once, the loss is yours', () => {
    const b = quiet();
    b.player.hull = 0;
    b.enemy.hull = 0;
    b.step(STEP);
    expect(b.outcome?.kind).toBe('defeat');
  });

  it("a merchant that runs from the first moment gets away unless you stop her, and escapes are no win", () => {
    const b = new Battle(playerShip('maw'), MERCHANT_BRIG, { seed: 3, enemyAI: { fleeAt: 1, surrenderChance: 0, surrenderAt: 0 } });
    expect(b.enemyRuns).toBe(true);
    run(b, 600);
    expect(b.outcome).toMatchObject({ kind: 'enemyEscaped', won: false });
  });
});

describe('boarding parties under AI command', () => {
  const setup = () => {
    const ours = new Ship(playerShip('wolf'), 'player');
    const hers = new Ship(MERCHANT_BRIG, 'enemy');
    const recalled: string[] = [];
    const ai = new ShipAI(ours, hers, new Rng(1), { ...CALM, boardWith: 2 }, { board: () => 0, recall: (c) => (recalled.push(c.name), true), inTransit: () => false });
    const boarder = ours.crew[1];
    ours.crew = ours.crew.filter((c) => c !== boarder);
    land(hers, boarder, 'guns');
    return { ours, hers, ai, boarder, recalled };
  };

  it('move on to the nearest system still worth wrecking once theirs is wrecked', () => {
    const { hers, ai, boarder } = setup();
    hers.damageSystem('guns', 99);
    ai.update(0.5);
    expect(destination(boarder)).toBe('surgeon');
  });

  it('stay put while they are wrecking the room they are in', () => {
    const { ai, boarder } = setup();
    ai.update(0.5);
    expect(destination(boarder)).toBe('guns');
  });

  it('stand idle when every system aboard her is wrecked', () => {
    const { hers, ai, boarder } = setup();
    for (const s of hers.systems.values()) hers.damageSystem(s.id, 99);
    ai.update(0.5);
    expect(boarder.waypoints).toHaveLength(0);
  });

  it('come home when badly hurt', () => {
    const { ai, boarder, recalled } = setup();
    boarder.hp = 20;
    ai.update(0.5);
    expect(recalled).toEqual([boarder.name]);
  });
});

describe('boarding nets', () => {
  it('wound boarders climbing over the rail, but never kill them, and spare your own people coming home', () => {
    const ship = new Ship(playerShip('gull'), 'player');
    ship.boardingNets = true;
    const raider = new Ship(NAVY_CUTTER, 'enemy').crew[0];
    land(ship, raider, 'sails');
    expect(raider.hp).toBe(100 - NET_DAMAGE);
    const weak = new Ship(NAVY_CUTTER, 'enemy').crew[1];
    weak.hp = 10;
    land(ship, weak, 'sails');
    expect(weak.hp).toBe(1);
    const own = new Ship(playerShip('gull'), 'player').crew[0];
    land(ship, own, 'helm');
    expect(own.hp).toBe(100);
  });

  it('land boarders in the nearest free room when theirs is full', () => {
    const ship = new Ship(MERCHANT_BRIG, 'enemy');
    const raiders = new Ship(playerShip('wolf'), 'player').crew;
    // The bowsprit-sized forecastle holds two.
    for (const c of raiders.slice(0, 3)) land(ship, c, 'fore');
    expect(raiders.slice(0, 3).map((c) => c.room)).toEqual(['fore', 'fore', expect.not.stringMatching(/^fore$/)]);
    const tiles = ship.crew.map((c) => `${c.slot.x},${c.slot.y}`);
    expect(new Set(tiles).size).toBe(tiles.length);
  });
});
