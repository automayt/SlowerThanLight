import { BOARD_TIME, canGrapple, land, updateBoarding, type Transit } from './Boarding';
import { changeShot, NO_HELM_RELOAD, UNCREWED_RELOAD, updateBulwarks, updateGuns, updateProjectiles, type CombatStats, type Projectile } from './Combat';
import { orderMove, updateCrew } from './Crew';
import { ShipAI, type AIOptions } from './EnemyAI';
import type { BattleEvent } from './events';
import { isSinking, updateHazards } from './Hazards';
import { Rng } from './rng';
import { GUNNERY_RELOAD, rank, train } from './Skills';
import { Ship, type Crew, type ShipCondition } from './Ship';
import type { ShipDef, ShotType, Side, SystemId } from './types';

export type OutcomeKind = 'victory' | 'surrender' | 'enemySunk' | 'captured' | 'escaped' | 'enemyEscaped' | 'defeat' | 'sunk' | 'crewLost';

export interface Outcome {
  kind: OutcomeKind;
  /** True when the player came out on top. */
  won: boolean;
  title: string;
  text: string;
  time: number;
}

export interface BattleOptions {
  seed?: number;
  enemyAI?: Partial<AIOptions>;
  /** Let an AI captain run the player's ship too (headless tests and balancing). */
  autoPlayer?: boolean;
  /** With autoPlayer: focus all guns on one enemy system. */
  playerFocus?: SystemId;
  /** Hull, crew and damage the player's ship brings into the fight (fresh from the yard when omitted). */
  playerCondition?: ShipCondition;
  /** False when there is no running from this fight. */
  allowEscape?: boolean;
  /** With autoPlayer: send boarding parties of this size. */
  playerBoardWith?: number;
  /** How fast enemy guns load, relative to normal (difficulty). */
  enemyReload?: number;
  /** How fast the player's guns load, relative to normal (gun drill). */
  playerReload?: number;
  /** The player has boarding nets rigged. */
  playerNets?: boolean;
  /** The final battle: low on hull, the enemy rallies once (repairs, fires out, loads faster). */
  boss?: boolean;
}

/** Hull fraction at which a boss rallies, and how much faster she then loads. */
export const BOSS_RALLY_AT = 0.4;
export const BOSS_RALLY_RELOAD = 1.1;

/** Fixed simulation step in seconds. */
export const STEP = 0.05;

/** Stations every fight should open with someone at, in order of need. */
const KEY_STATIONS: SystemId[] = ['helm', 'guns', 'sails'];

/**
 * Seconds of load gained per second by a ship's guns right now: the same rate Combat.updateGuns applies
 * (gun crew, the best gunner's rank, a manned helm to bring her to bear, and drill or difficulty).
 */
export function gunLoadRate(ship: Ship): number {
  const crew = ship.gunCrew();
  const best = crew.reduce((n, c) => Math.max(n, rank(c, 'gunnery')), 0);
  const crewed = crew.length === 0 ? UNCREWED_RELOAD : crew.length === 1 ? 1.15 : 1.3;
  const bearing = ship.level('helm') > 0 && ship.isManned('helm') ? 1 : NO_HELM_RELOAD;
  return (crewed + (crew.length ? best * GUNNERY_RELOAD : 0)) * bearing * ship.reloadRate;
}

/**
 * Before the first shot, send spare crew (nobody's station, or doubled up on one) to any of helm, guns and sails
 * left empty, so a fresh hire or a dead gunner's place doesn't open the fight with an unmanned station.
 */
export function manStations(ship: Ship): void {
  const stationOf = (c: Crew) => ship.room(c.room).def.system;
  for (const id of KEY_STATIONS) {
    const sys = ship.system(id);
    if (!sys || ship.own().some((c) => c.room === sys.room)) continue;
    const count = (room: string) => ship.own().filter((c) => c.room === room).length;
    // Idle hands first, then the spare from a crowded station (the gun deck last: a second gunner loads faster).
    const spare =
      ship.own().find((c) => !stationOf(c)) ??
      ship.own().find((c) => stationOf(c) !== 'guns' && count(c.room) > 1) ??
      ship.own().find((c) => count(c.room) > 1);
    const slot = spare && ship.freeSlot(sys.room, spare);
    if (!spare || !slot) continue;
    spare.room = spare.home = sys.room;
    spare.slot = slot;
    spare.pos = { x: slot.x + 0.5, y: slot.y + 0.5 };
    spare.waypoints = [];
  }
}

export class Battle {
  readonly player: Ship;
  readonly enemy: Ship;
  readonly rng: Rng;
  readonly seed: number;
  readonly allowEscape: boolean;
  readonly boss: boolean;
  /** Whether the boss has rallied yet. */
  rallied = false;
  /** The enemy runs from the first moment (a merchant or smuggler): only crippling her stops her. */
  readonly enemyRuns: boolean;
  /** The player's guns are holding fire because her own boarders are over there. */
  holdingFire = false;
  /** Crew aboard each ship when the battle began. */
  readonly crewAtStart: Record<Side, number>;
  time = 0;
  paused = false;
  outcome: Outcome | null = null;
  projectiles: Projectile[] = [];
  /** Crew crossing between the ships. */
  transit: Transit[] = [];
  readonly stats: Record<Side, CombatStats> = {
    player: { shotsFired: 0, hits: 0, hullDamage: 0 },
    enemy: { shotsFired: 0, hits: 0, hullDamage: 0 },
  };
  private events: BattleEvent[] = [];
  private readonly enemyAI: ShipAI;
  private readonly playerAI: ShipAI | null;
  private acc = 0;

  constructor(playerDef: ShipDef, enemyDef: ShipDef, opts: BattleOptions = {}) {
    this.seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = new Rng(this.seed);
    this.allowEscape = opts.allowEscape ?? true;
    this.boss = opts.boss ?? false;
    this.player = new Ship(playerDef, 'player', opts.playerCondition);
    this.enemy = new Ship(enemyDef, 'enemy');
    manStations(this.player);
    this.enemyRuns = (opts.enemyAI?.fleeAt ?? 0) >= 1;
    // Crew take up their stations before the first tick, so a paused opening already shows a manned helm.
    updateCrew(this.player, 0);
    updateCrew(this.enemy, 0);
    this.enemy.reloadRate = opts.enemyReload ?? 1;
    this.player.reloadRate = opts.playerReload ?? 1;
    this.player.boardingNets = opts.playerNets ?? false;
    this.crewAtStart = { player: this.player.crew.length, enemy: this.enemy.crew.length };
    const actions = (side: Side) => ({
      board: (crew: Crew[], room: string) => this.board(side, crew, room),
      recall: (crew: Crew) => this.recall(side, crew),
      inTransit: () => this.transit.some((t) => t.crew.side === side),
    });
    this.enemyAI = new ShipAI(
      this.enemy,
      this.player,
      this.rng,
      { fleeAt: 0.3, surrenderChance: 0.35, surrenderAt: 0.25, ...opts.enemyAI },
      actions('enemy'),
    );
    this.playerAI = opts.autoPlayer
      ? new ShipAI(
          this.player,
          this.enemy,
          this.rng,
          { fleeAt: 0, surrenderChance: 0, surrenderAt: 0, focus: opts.playerFocus, boardWith: opts.playerBoardWith },
          actions('player'),
        )
      : null;
  }

  get enemyFleeing(): boolean {
    return this.enemyAI.fleeing;
  }

  get ships(): Record<Side, Ship> {
    return { player: this.player, enemy: this.enemy };
  }

  /** True while anyone is aboard the other ship or crossing: the ships are lashed together and neither can sail away. */
  get grappled(): boolean {
    return this.transit.length > 0 || this.player.boarders().length > 0 || this.enemy.boarders().length > 0;
  }

  /** Whether any of your crew are aboard her or crossing to her. */
  get boardersOut(): boolean {
    return this.enemy.crew.some((c) => c.side === 'player') || this.transit.some((t) => t.crew.side === 'player' && t.to === 'enemy');
  }

  /** Every living crew member of one side, wherever they are. */
  crewOf(side: Side): Crew[] {
    return [...this.player.crew, ...this.enemy.crew, ...this.transit.map((t) => t.crew)].filter((c) => c.side === side);
  }

  /** The ship a crew member is standing on, or null while crossing. */
  shipOf(crew: Crew): Ship | null {
    return this.player.crew.includes(crew) ? this.player : this.enemy.crew.includes(crew) ? this.enemy : null;
  }

  /** Advance by real elapsed seconds, in fixed steps. */
  update(realDt: number): void {
    if (this.paused || this.outcome) return;
    this.acc = Math.min(this.acc + realDt, 0.25);
    while (this.acc >= STEP && !this.outcome) {
      this.acc -= STEP;
      this.step(STEP);
    }
  }

  step(dt: number): void {
    if (this.outcome) return;
    this.time += dt;

    const enemyMove = this.enemyAI.update(dt);
    if (enemyMove === 'surrender') return this.finish('surrender');
    if (enemyMove === 'escape') return this.finish('enemyEscaped');
    this.playerAI?.update(dt);

    this.updateTransit(dt);
    const grappled = this.grappled;
    for (const [ship, foe] of [
      [this.player, this.enemy],
      [this.enemy, this.player],
    ] as const) {
      updateCrew(ship, dt);
      updateBoarding(ship, dt, this.events);
      updateHazards(ship, dt, this.rng, this.events);
      // The enemy only starts making sail once it decides to run, and nobody gets away while grappled.
      const sailing = (ship === this.player && this.allowEscape) || (ship === this.enemy && this.enemyAI.fleeing);
      if (sailing && !grappled) ship.escape = Math.min(100, ship.escape + ship.escapeRate() * dt);
      updateBulwarks(ship, dt);
      if (ship === this.player) this.updatePlayerGuns(dt);
      else updateGuns(ship, foe, dt, this.projectiles, this.events, this.stats[ship.side]);
    }
    this.projectiles = updateProjectiles(this.projectiles, this.ships, dt, this.rng, this.events, this.stats);
    // Steering under fire is how helmsmen learn.
    const helmsman = this.player.stationed('helm');
    if (helmsman) train(helmsman, 'seamanship', dt * 0.5, this.events);

    for (const ship of [this.player, this.enemy]) {
      const dead = ship.crew.filter((c) => c.hp <= 0);
      if (!dead.length) continue;
      ship.crew = ship.crew.filter((c) => c.hp > 0);
      for (const c of dead) this.events.push({ t: 'death', side: c.side, name: c.name });
    }

    if (this.boss && !this.rallied && this.enemy.hull > 0 && this.enemy.hull <= this.enemy.def.hull * BOSS_RALLY_AT) this.rally();
    if (this.player.hull <= 0) return this.finish('defeat');
    if (isSinking(this.player)) return this.finish('sunk');
    if (!this.crewOf('player').length) return this.finish('crewLost');
    if (this.enemy.hull <= 0) return this.finish('victory');
    if (isSinking(this.enemy)) return this.finish('enemySunk');
    if (!this.crewOf('enemy').length) return this.finish('captured');
  }

  /**
   * The player's guns load as usual, but hold fire while her own people are aboard the enemy or crossing:
   * a lucky ball could sink the prize under them. Targets are lifted for the tick so loaded guns simply wait.
   */
  private updatePlayerGuns(dt: number): void {
    const hold = this.boardersOut;
    if (hold && !this.holdingFire) this.events.push({ t: 'log', side: 'player', text: 'Our boarders are aboard her: the guns hold fire until they are back or she is taken.' });
    this.holdingFire = hold;
    const targets = this.player.guns.map((g) => g.target);
    if (hold) for (const g of this.player.guns) g.target = null;
    updateGuns(this.player, this.enemy, dt, this.projectiles, this.events, this.stats.player);
    if (hold) this.player.guns.forEach((g, i) => (g.target = targets[i]));
  }

  /** The boss's second wind: every system repaired, fires out, bulwarks up, her guns served a little faster. */
  private rally(): void {
    this.rallied = true;
    const e = this.enemy;
    for (const s of e.systems.values()) {
      s.damage = 0;
      s.repair = 0;
    }
    for (const r of e.rooms.values()) {
      r.fire = 0;
      r.breach = false;
    }
    e.restoreWanted();
    e.layers = e.level('bulwarks');
    e.reloadRate *= BOSS_RALLY_RELOAD;
    this.events.push({ t: 'rally', side: 'enemy', text: 'The Commodore rallies his crew! Fires out, damage made good, and his guns run out faster.' });
  }

  /** Run headless until the battle ends or the time limit passes. */
  runToEnd(maxSeconds = 600): Outcome | null {
    while (!this.outcome && this.time < maxSeconds) this.step(STEP);
    return this.outcome;
  }

  drainEvents(): BattleEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // --- Player commands -------------------------------------------------

  togglePause(): void {
    this.paused = !this.paused;
  }

  /**
   * Order one of your crew to a room on either ship. Walking within a ship is a normal move;
   * a room on the other ship means boarding (or coming home).
   */
  moveCrew(crewId: number, roomId: string, onShip: Side = 'player'): boolean {
    const c = this.crewOf('player').find((x) => x.id === crewId);
    const here = c && this.shipOf(c);
    if (!c || !here || this.outcome) return false;
    const target = this.ships[onShip];
    if (!target.rooms.has(roomId)) return false;
    if (here === target) return orderMove(here, c, roomId);
    if (onShip === 'enemy') return this.canBoard() && this.board('player', [c], roomId) > 0;
    return this.recall('player', c, roomId);
  }

  /** Order several of your crew at once; those boarding from your deck cross together as one party. */
  orderCrew(crewIds: Iterable<number>, roomId: string, onShip: Side = 'player'): number {
    const mine = this.crewOf('player');
    const party: Crew[] = [];
    let moved = 0;
    for (const id of crewIds) {
      const c = mine.find((x) => x.id === id);
      if (!c) continue;
      if (onShip === 'enemy' && this.shipOf(c) === this.player) party.push(c);
      else if (this.moveCrew(id, roomId, onShip)) moved++;
    }
    if (party.length && this.canBoard() && this.enemy.rooms.has(roomId) && !this.outcome) moved += this.board('player', party, roomId);
    return moved;
  }

  /** Whether your crew can board the enemy right now. */
  canBoard(): boolean {
    return !this.outcome && canGrapple(this.player, this.enemy);
  }

  /** Send crew of one side across to a room on the other ship. Returns how many went. */
  board(side: Side, crew: Crew[], roomId: string): number {
    const from = this.ships[side];
    const to: Side = side === 'player' ? 'enemy' : 'player';
    let sent = 0;
    for (const c of crew) {
      if (c.side !== side || !from.crew.includes(c)) continue;
      from.crew = from.crew.filter((x) => x !== c);
      c.waypoints = [];
      c.task = 'moving';
      this.transit.push({ crew: c, to, room: roomId, t: BOARD_TIME });
      sent++;
    }
    if (sent) this.events.push({ t: 'board', side, count: sent, room: roomId });
    return sent;
  }

  /** Bring a boarder back to their own ship. */
  recall(side: Side, crew: Crew, roomId?: string): boolean {
    const away = this.ships[side === 'player' ? 'enemy' : 'player'];
    if (crew.side !== side || !away.crew.includes(crew)) return false;
    away.crew = away.crew.filter((x) => x !== crew);
    crew.waypoints = [];
    crew.task = 'moving';
    this.transit.push({ crew, to: side, room: roomId ?? crew.home, t: BOARD_TIME });
    return true;
  }

  private updateTransit(dt: number): void {
    if (!this.transit.length) return;
    const still: Transit[] = [];
    for (const tr of this.transit) {
      tr.t -= dt;
      if (tr.t > 0) still.push(tr);
      else land(this.ships[tr.to], tr.crew, tr.room);
    }
    this.transit = still;
  }

  addHands(system: SystemId, delta: number): boolean {
    return this.player.addHands(system, delta);
  }

  toggleGun(index: number): boolean {
    return this.player.toggleGun(index);
  }

  aimGun(index: number, roomId: string | null): void {
    const g = this.player.guns[index];
    if (g && (roomId === null || this.enemy.rooms.has(roomId))) g.target = roomId;
  }

  /** Hold the guns and fire them together once all are loaded. */
  setBroadside(on: boolean): void {
    this.player.broadside = on;
  }

  setShot(index: number, shot: ShotType): void {
    const g = this.player.guns[index];
    if (g) changeShot(g, shot);
  }

  canEscape(): boolean {
    return this.allowEscape && this.player.escape >= 100 && !this.outcome && !this.grappled;
  }

  escape(): boolean {
    if (!this.canEscape()) return false;
    this.finish('escaped');
    return true;
  }

  private finish(kind: OutcomeKind): void {
    // Boarders come home (the enemy is sinking, struck, or yours); hers are thrown off.
    const away = [...this.enemy.crew, ...this.transit.map((t) => t.crew)].filter((c) => c.side === 'player' && c.hp > 0);
    this.enemy.crew = this.enemy.crew.filter((c) => c.side === 'enemy');
    this.player.crew = this.player.crew.filter((c) => c.side === 'player');
    this.transit = [];
    for (const c of away) land(this.player, c, c.home);
    const enemy = this.enemy.def.name;
    const text: Record<OutcomeKind, [boolean, string, string]> = {
      victory: [true, 'Victory!', `${enemy} breaks apart and slips beneath the waves.`],
      enemySunk: [true, 'Victory!', `${enemy} takes on too much water and founders.`],
      captured: [true, 'Prize Taken!', `Not a soul left standing aboard ${enemy}. She's yours.`],
      surrender: [true, 'They Strike Their Colours!', `${enemy} hauls down her flag and surrenders.`],
      escaped: [false, 'Escaped', `You crowd on every scrap of canvas and leave ${enemy} in your wake.`],
      enemyEscaped: [false, 'She Got Away', `${enemy} catches the wind and flees beyond the horizon.`],
      defeat: [false, 'Defeat', `Your hull splinters under the guns of ${enemy}. The sea takes her.`],
      sunk: [false, 'Sunk', 'The water rises faster than the pumps can bail. Your ship goes down.'],
      crewLost: [false, 'All Hands Lost', 'There is no one left to sail her.'],
    };
    const [won, title, body] = text[kind];
    this.outcome = { kind, won, title, text: body, time: this.time };
  }
}
