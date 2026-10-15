import { changeShot, updateGuns, updateProjectiles, type CombatStats, type Projectile } from './Combat';
import { orderMove, updateCrew } from './Crew';
import { ShipAI, type AIOptions } from './EnemyAI';
import type { BattleEvent } from './events';
import { isSinking, updateHazards } from './Hazards';
import { Rng } from './rng';
import { Ship, type ShipCondition } from './Ship';
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
}

/** Fixed simulation step in seconds. */
export const STEP = 0.05;

export class Battle {
  readonly player: Ship;
  readonly enemy: Ship;
  readonly rng: Rng;
  readonly seed: number;
  readonly allowEscape: boolean;
  time = 0;
  paused = false;
  outcome: Outcome | null = null;
  projectiles: Projectile[] = [];
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
    this.player = new Ship(playerDef, 'player', opts.playerCondition);
    this.enemy = new Ship(enemyDef, 'enemy');
    this.enemyAI = new ShipAI(this.enemy, this.player, this.rng, {
      fleeAt: 0.3,
      surrenderChance: 0.35,
      surrenderAt: 0.25,
      ...opts.enemyAI,
    });
    this.playerAI = opts.autoPlayer ? new ShipAI(this.player, this.enemy, this.rng, { fleeAt: 0, surrenderChance: 0, surrenderAt: 0, focus: opts.playerFocus }) : null;
  }

  get enemyFleeing(): boolean {
    return this.enemyAI.fleeing;
  }

  get ships(): Record<Side, Ship> {
    return { player: this.player, enemy: this.enemy };
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

    for (const [ship, foe] of [
      [this.player, this.enemy],
      [this.enemy, this.player],
    ] as const) {
      updateCrew(ship, dt);
      updateHazards(ship, dt, this.rng, this.events);
      // The enemy only starts making sail once it decides to run.
      if ((ship === this.player && this.allowEscape) || (ship === this.enemy && this.enemyAI.fleeing)) ship.escape = Math.min(100, ship.escape + ship.escapeRate() * dt);
      updateGuns(ship, foe, dt, this.projectiles, this.events, this.stats[ship.side]);
    }
    this.projectiles = updateProjectiles(this.projectiles, this.ships, dt, this.rng, this.events, this.stats);

    for (const ship of [this.player, this.enemy]) {
      const dead = ship.crew.filter((c) => c.hp <= 0);
      if (!dead.length) continue;
      ship.crew = ship.crew.filter((c) => c.hp > 0);
      for (const c of dead) this.events.push({ t: 'death', side: ship.side, name: c.name });
    }

    if (this.player.hull <= 0) return this.finish('defeat');
    if (isSinking(this.player)) return this.finish('sunk');
    if (!this.player.crew.length) return this.finish('crewLost');
    if (this.enemy.hull <= 0) return this.finish('victory');
    if (isSinking(this.enemy)) return this.finish('enemySunk');
    if (!this.enemy.crew.length) return this.finish('captured');
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

  moveCrew(crewId: number, roomId: string): boolean {
    const c = this.player.crew.find((x) => x.id === crewId);
    return !!c && orderMove(this.player, c, roomId);
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

  setShot(index: number, shot: ShotType): void {
    const g = this.player.guns[index];
    if (g) changeShot(g, shot);
  }

  canEscape(): boolean {
    return this.allowEscape && this.player.escape >= 100 && !this.outcome;
  }

  escape(): boolean {
    if (!this.canEscape()) return false;
    this.finish('escaped');
    return true;
  }

  private finish(kind: OutcomeKind): void {
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
