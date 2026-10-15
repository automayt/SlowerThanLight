import { enemy } from '../data/enemies';
import { playerShip } from '../data/ships';
import { PORT_NAMES, RECRUIT_NAMES, SEA_EVENTS, seaEvent } from '../data/voyage';
import { Battle, type BattleOptions, type OutcomeKind } from './Battle';
import { Rng } from './rng';
import { generateChart, nodeById, type SeaChart, type SeaNode } from './SeaChart';
import { Ship, type ShipCondition } from './Ship';
import type { EnemyDef, EventEffect, SeaEventDef, ShipDef, SystemId } from './types';

/** Where the Navy fleet starts, in chart columns (the player starts in column 0). */
export const NAVY_START = -2.5;
/** Columns the fleet advances per jump. A little faster than you, so dawdling catches up with you. */
export const NAVY_SPEED = 1.25;
/** Columns the fleet loses when you sink one of its pickets. */
export const AMBUSH_SETBACK = 1;
/** Columns the fleet gains when a ship you fought gets away to raise the alarm. */
export const ALARM_DELAY = 0.5;
/** Columns the fleet gains while you rest and refit in port. */
export const PORT_REST_DELAY = 0.5;

export const START_GOLD = 20;
export const HULL_PRICE = 3;
export const CREW_PRICE = 30;
/** Hired crew allowed above the ship's starting complement. */
export const EXTRA_CREW = 2;
/** Healing per jump while under way. */
export const JUMP_HEAL = 15;

/** Share of the enemy's hold you get to keep, by how the fight ended. */
export const PLUNDER_SHARE: Partial<Record<OutcomeKind, number>> = {
  surrender: 1,
  captured: 1,
  victory: 0.6,
  enemySunk: 0.4,
};

export type RunStatus = 'chart' | 'battle' | 'event' | 'port' | 'won' | 'lost';

export type Encounter =
  | { kind: 'battle'; enemy: string; boss: boolean; ambush: boolean; text: string }
  | { kind: 'event'; event: string }
  | { kind: 'port'; name: string; rested: boolean }
  | { kind: 'empty'; text: string }
  | { kind: 'start' };

export interface BattleReport {
  kind: OutcomeKind;
  won: boolean;
  plunder: number;
  lines: string[];
}

export interface EventResult {
  effect: EventEffect;
  /** Plain-language summary of what changed. */
  changes: string[];
}

/** One voyage from Tortuga to the blockade. Pure state: scenes read it and call its methods. */
export class Run {
  readonly seed: number;
  readonly rng: Rng;
  readonly def: ShipDef;
  readonly chart: SeaChart;
  nodeId = 0;
  /** Column the Navy fleet has reached; nodes at or behind it are overrun. */
  navy = NAVY_START;
  gold = START_GOLD;
  condition: ShipCondition;
  status: RunStatus = 'chart';
  encounter: Encounter = { kind: 'start' };
  jumps = 0;
  visited: number[] = [0];
  battlesWon = 0;
  plunderTaken = 0;
  /** Why the run ended, once it has. */
  ending = '';
  private usedNames = new Set<string>();

  constructor(shipId: string, seed?: number) {
    this.seed = seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = new Rng(this.seed);
    this.def = playerShip(shipId);
    this.condition = new Ship(this.def, 'player').condition();
    for (const c of this.condition.crew) this.usedNames.add(c.name);
    this.chart = generateChart(this.rng, { events: SEA_EVENTS.map((e) => e.id), ports: PORT_NAMES });
  }

  get node(): SeaNode {
    return nodeById(this.chart, this.nodeId);
  }

  get over(): boolean {
    return this.status === 'won' || this.status === 'lost';
  }

  get maxCrew(): number {
    return this.def.crew.length + EXTRA_CREW;
  }

  /** Nodes you can sail to next. */
  reachable(): SeaNode[] {
    if (this.status !== 'chart') return [];
    return this.node.next.map((id) => nodeById(this.chart, id));
  }

  /** True if the fleet will have overrun this node by the time you get there. */
  willBeOverrun(node: SeaNode): boolean {
    return node.kind !== 'boss' && node.col <= this.navy + NAVY_SPEED;
  }

  /** Sail to a neighbouring node. The crew make running repairs and the fleet advances. */
  jump(id: number): Encounter {
    const node = this.reachable().find((n) => n.id === id);
    if (!node) throw new Error(`Cannot sail to node ${id} from ${this.nodeId}`);
    const overrun = this.willBeOverrun(node);
    this.nodeId = id;
    this.jumps++;
    this.visited.push(id);
    this.runningRepairs();
    this.navy += NAVY_SPEED;

    if (node.kind === 'boss') {
      const foe = enemy(node.enemy ?? 'frigate');
      return this.begin({ kind: 'battle', enemy: foe.id, boss: true, ambush: false, text: foe.sighting });
    }
    if (overrun) {
      return this.begin({ kind: 'battle', enemy: 'cutter', boss: false, ambush: true, text: 'The fleet has overrun these waters. A Navy cutter of the vanguard bears down on you!' });
    }
    switch (node.kind) {
      case 'battle': {
        const foe = enemy(node.enemy ?? 'cutter');
        return this.begin({ kind: 'battle', enemy: foe.id, boss: false, ambush: false, text: foe.sighting });
      }
      case 'event':
        return this.begin({ kind: 'event', event: node.event ?? SEA_EVENTS[0].id });
      case 'port':
        return this.begin({ kind: 'port', name: node.name ?? 'Nassau', rested: false });
      default:
        return this.begin({ kind: 'empty', text: 'Open water and a fair wind. The crew make running repairs.' });
    }
  }

  private begin(enc: Encounter): Encounter {
    this.encounter = enc;
    this.status = enc.kind === 'battle' ? 'battle' : enc.kind === 'event' ? 'event' : enc.kind === 'port' ? 'port' : 'chart';
    return enc;
  }

  /** Between nodes: wounds mend a little and the carpenter fixes the worst-damaged system by one point. */
  private runningRepairs(): void {
    for (const c of this.condition.crew) c.hp = Math.min(100, c.hp + JUMP_HEAL);
    const worst = (Object.entries(this.condition.damage) as [SystemId, number][]).sort((a, b) => b[1] - a[1])[0];
    if (worst) this.setDamage(worst[0], worst[1] - 1);
  }

  private setDamage(id: SystemId, amount: number): void {
    if (amount > 0) this.condition.damage[id] = amount;
    else delete this.condition.damage[id];
  }

  // --- Battles ------------------------------------------------------------

  currentEnemy(): EnemyDef {
    if (this.encounter.kind !== 'battle') throw new Error('No battle in progress');
    return enemy(this.encounter.enemy);
  }

  /** Build the fight for the current battle encounter. */
  startBattle(opts: Partial<BattleOptions> = {}): Battle {
    if (this.status !== 'battle' || this.encounter.kind !== 'battle') throw new Error('No battle to start');
    const foe = this.currentEnemy();
    return new Battle(this.def, foe.ship, {
      seed: this.rng.int(2 ** 31),
      enemyAI: foe.ai,
      playerCondition: this.condition,
      allowEscape: !this.encounter.boss,
      ...opts,
    });
  }

  /** Record a finished battle: damage carried, plunder taken, the fleet's reaction. */
  finishBattle(battle: Battle): BattleReport {
    if (this.encounter.kind !== 'battle') throw new Error('No battle in progress');
    const o = battle.outcome;
    if (!o) throw new Error('Battle has not finished');
    const enc = this.encounter;
    const foe = enemy(enc.enemy);
    this.condition = battle.player.condition();
    const lines: string[] = [];
    let plunder = 0;

    if (o.won) {
      this.battlesWon++;
      const share = PLUNDER_SHARE[o.kind] ?? 0;
      plunder = Math.round((foe.plunder[0] + this.rng.int(foe.plunder[1] - foe.plunder[0] + 1)) * share);
      if (!enc.boss && plunder > 0) {
        this.gold += plunder;
        this.plunderTaken += plunder;
        lines.push(o.kind === 'enemySunk' || o.kind === 'victory' ? `You fish ${plunder} gold from the wreckage.` : `Her hold yields ${plunder} gold.`);
      }
      if (enc.ambush) {
        this.navy -= AMBUSH_SETBACK;
        lines.push('With her vanguard sunk, the fleet falls back to regroup.');
      }
    } else if (o.kind === 'enemyEscaped' && foe.faction !== 'navy') {
      this.navy += ALARM_DELAY;
      lines.push('She will raise the alarm. The fleet closes in.');
    }

    if (o.kind === 'defeat' || o.kind === 'sunk' || o.kind === 'crewLost') {
      this.end('lost', o.title);
    } else if (enc.boss && o.won) {
      this.end('won', 'You broke the blockade!');
    } else {
      this.status = 'chart';
    }
    return { kind: o.kind, won: o.won, plunder: enc.boss ? 0 : plunder, lines };
  }

  /** Give up the voyage (used by headless runs for stalemates). */
  concede(reason: string): void {
    this.end('lost', reason);
  }

  private end(status: 'won' | 'lost', reason: string): void {
    this.status = status;
    this.ending = reason;
  }

  // --- Events ---------------------------------------------------------------

  currentEvent(): SeaEventDef {
    if (this.encounter.kind !== 'event') throw new Error('No event in progress');
    return seaEvent(this.encounter.event);
  }

  canChoose(index: number): boolean {
    const choice = this.currentEvent().choices[index];
    return !!choice && this.gold >= (choice.cost ?? 0);
  }

  chooseEvent(index: number): EventResult {
    if (this.status !== 'event') throw new Error('No event in progress');
    if (!this.canChoose(index)) throw new Error(`Choice ${index} is not available`);
    const choice = this.currentEvent().choices[index];
    this.gold -= choice.cost ?? 0;
    const effect = this.rng.weighted(choice.outcomes, (o) => o.weight).effect;
    const changes = this.applyEffect(effect);
    if (choice.cost) changes.unshift(`−${choice.cost} gold`);
    if (effect.battle) {
      const foe = enemy(effect.battle);
      this.begin({ kind: 'battle', enemy: foe.id, boss: false, ambush: false, text: effect.text });
    } else {
      this.status = 'chart';
    }
    return { effect, changes };
  }

  /** Apply an event's effect and describe it. Events can hurt you but never end the voyage. */
  applyEffect(e: EventEffect): string[] {
    const out: string[] = [];
    const c = this.condition;
    if (e.gold) {
      const before = this.gold;
      this.gold = Math.max(0, this.gold + e.gold);
      out.push(`${e.gold > 0 ? '+' : '−'}${Math.abs(this.gold - before)} gold`);
    }
    if (e.hull) {
      const before = c.hull;
      c.hull = Math.max(1, Math.min(this.def.hull, c.hull + e.hull));
      if (c.hull !== before) out.push(`${c.hull > before ? '+' : '−'}${Math.abs(c.hull - before)} hull`);
    }
    if (e.crewHp) {
      for (const m of c.crew) m.hp = Math.max(1, Math.min(100, m.hp + e.crewHp));
      out.push(e.crewHp > 0 ? 'Crew healed' : 'Crew wounded');
    }
    if (e.repair && Object.keys(c.damage).length) {
      c.damage = {};
      out.push('Systems repaired');
    }
    for (let i = 0; i < (e.loseCrew ?? 0) && c.crew.length > 1; i++) {
      const lost = c.crew.splice(this.rng.int(c.crew.length), 1)[0];
      out.push(`${lost.name} lost`);
    }
    for (let i = 0; i < (e.recruit ?? 0); i++) {
      const name = this.recruit();
      out.push(name ? `${name} joins the crew` : 'No bunk to spare: they stay ashore');
    }
    if (e.navy) {
      this.navy += e.navy;
      out.push(e.navy > 0 ? 'The Navy gains on you' : 'You gain on the Navy');
    }
    return out;
  }

  /** Sign on a new crew member if there is room. Returns their name, or null when the ship is full. */
  private recruit(): string | null {
    if (this.condition.crew.length >= this.maxCrew) return null;
    const free = RECRUIT_NAMES.filter((n) => !this.usedNames.has(n));
    const name = free.length ? this.rng.pick(free) : `Hand #${this.usedNames.size + 1}`;
    this.usedNames.add(name);
    this.condition.crew.push({ name, hp: 100, home: '' });
    return name;
  }

  // --- Port ---------------------------------------------------------------

  /** Hull points missing. */
  hullMissing(): number {
    return this.def.hull - this.condition.hull;
  }

  canRest(): boolean {
    return this.status === 'port' && this.encounter.kind === 'port' && !this.encounter.rested;
  }

  /** Rest the crew and let the shipwrights mend every system, while the fleet gains on you. */
  rest(): boolean {
    if (!this.canRest() || this.encounter.kind !== 'port') return false;
    this.encounter.rested = true;
    for (const c of this.condition.crew) c.hp = 100;
    this.condition.damage = {};
    this.navy += PORT_REST_DELAY;
    return true;
  }

  canRepairHull(points = 1): boolean {
    return this.status === 'port' && points > 0 && this.hullMissing() >= points && this.gold >= points * HULL_PRICE;
  }

  repairHull(points = 1): boolean {
    if (!this.canRepairHull(points)) return false;
    this.gold -= points * HULL_PRICE;
    this.condition.hull += points;
    return true;
  }

  canHire(): boolean {
    return this.status === 'port' && this.gold >= CREW_PRICE && this.condition.crew.length < this.maxCrew;
  }

  hireCrew(): string | null {
    if (!this.canHire()) return null;
    this.gold -= CREW_PRICE;
    return this.recruit();
  }

  leavePort(): void {
    if (this.status === 'port') this.status = 'chart';
  }
}
