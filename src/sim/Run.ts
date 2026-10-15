import { enemy } from '../data/enemies';
import { playerShip } from '../data/ships';
import { PORT_NAMES, RECRUIT_NAMES, SEA_EVENTS, seaEvent } from '../data/voyage';
import { WEAPONS, weapon } from '../data/weapons';
import { Battle, type BattleOptions, type OutcomeKind } from './Battle';
import { Rng } from './rng';
import { generateChart, nodeById, type SeaChart, type SeaNode } from './SeaChart';
import { Ship, type ShipCondition } from './Ship';
import type { EnemyDef, EventEffect, EventNeeds, EventPool, EventRarity, GunMount, SeaEventDef, ShipDef, SystemId, UpgradeId, WeaponDef } from './types';
import { SYSTEM_NAMES } from './types';

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

export const START_GOLD = 30;
export const HULL_PRICE = 3;
export const CREW_PRICE = 30;
/** Hired crew allowed above the ship's starting complement. */
export const EXTRA_CREW = 2;
/** Healing per jump while under way. */
export const JUMP_HEAL = 15;

/** Gun ports on every ship. */
export const MAX_GUNS = 4;
/** Most bars a shipwright can give each system. */
export const SYSTEM_CAP: Record<SystemId, number> = { helm: 3, sails: 6, guns: 8, pumps: 4, surgeon: 3 };
/** Deckhands you can sign on above the ship's own. */
export const EXTRA_HANDS = 3;
/** Max hull added by each round of oak planking, and how many rounds a ship can take. */
export const PLATING = 3;
export const MAX_PLATING = 2;

/** Weapons sold in port armouries, cheapest first. */
export const ARMOURY = Object.values(WEAPONS)
  .sort((a, b) => a.price - b.price)
  .map((w) => w.id);

export type { UpgradeId };

/** How often each rarity is drawn, relative to the others. */
export const RARITY_WEIGHT: Record<EventRarity, number> = { common: 10, uncommon: 5, rare: 2, legendary: 0.6 };
/** How a missing story flag is described on a locked choice. */
const FLAG_LACKING: Record<string, string> = { cat: 'no ship’s cat', 'map-half': 'no map', 'map-whole': 'no map', cursed: 'not cursed' };
/** Weight multiplier for events that follow on from a story flag. */
export const STORY_BOOST = 2;
/** Chance that crossing open sea brings an incident aboard. */
export const INCIDENT_CHANCE = 0.6;

export interface UpgradeOffer {
  id: UpgradeId;
  label: string;
  detail: string;
  price: number;
  /** Already at its cap; can never be bought again. */
  maxed: boolean;
  available: boolean;
}

export interface GunOffer {
  weapon: WeaponDef;
  price: number;
  available: boolean;
}

/** How the ship is fitted out: starts as built, changed by the shipwright and the armoury. */
export interface ShipFit {
  hull: number;
  hands: number;
  systems: Partial<Record<SystemId, number>>;
  guns: GunMount[];
}

/** Everything needed to pick a voyage back up. */
export interface RunSave {
  version: 1;
  shipId: string;
  seed: number;
  rng: number;
  chart: SeaChart;
  nodeId: number;
  navy: number;
  gold: number;
  condition: ShipCondition;
  fit: ShipFit;
  status: RunStatus;
  encounter: Encounter;
  jumps: number;
  visited: number[];
  battlesWon: number;
  plunderTaken: number;
  ending: string;
  usedNames: string[];
  /** Added after the first saves; optional so older saves still load. */
  endingTitle?: string;
  flags?: string[];
  seenEvents?: string[];
}

/** Share of the enemy's hold you get to keep, by how the fight ended. */
export const PLUNDER_SHARE: Partial<Record<OutcomeKind, number>> = {
  surrender: 1,
  captured: 1,
  victory: 0.6,
  enemySunk: 0.4,
};

export type RunStatus = 'chart' | 'battle' | 'event' | 'port' | 'won' | 'lost';

export type Encounter =
  | { kind: 'battle'; enemy: string; name: string; boss: boolean; ambush: boolean; text: string }
  | { kind: 'event'; event: string; actor?: string; actor2?: string; variant?: number }
  | { kind: 'port'; name: string; rested: boolean; stock: string[] }
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
  chart: SeaChart;
  fit: ShipFit;
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
  /** Title for an unusual ending (set by events); empty for the usual ones. */
  endingTitle = '';
  /** Story flags set by events, for events that follow on from them. */
  flags = new Set<string>();
  /** Events met this voyage, in order. */
  seenEvents: string[] = [];
  private usedNames = new Set<string>();

  constructor(shipId: string, seed?: number) {
    this.seed = seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = new Rng(this.seed);
    this.def = playerShip(shipId);
    this.condition = new Ship(this.def, 'player').condition();
    for (const c of this.condition.crew) this.usedNames.add(c.name);
    this.fit = { hull: this.def.hull, hands: this.def.hands, systems: { ...this.def.systems }, guns: this.def.guns.map((g) => ({ ...g })) };
    this.chart = generateChart(this.rng, { ports: PORT_NAMES, armoury: ARMOURY });
  }

  /** The ship as currently fitted out. */
  get ship(): ShipDef {
    const f = this.fit;
    return { ...this.def, hull: f.hull, hands: f.hands, systems: { ...f.systems }, guns: f.guns.map((g) => ({ ...g })) };
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
      return this.begin({ kind: 'battle', enemy: foe.id, name: this.shipName(foe), boss: true, ambush: false, text: foe.sighting });
    }
    if (overrun) {
      const foe = enemy('cutter');
      const text = 'The fleet has overrun these waters. A Navy cutter of the vanguard bears down on you!';
      return this.begin({ kind: 'battle', enemy: foe.id, name: this.shipName(foe), boss: false, ambush: true, text });
    }
    switch (node.kind) {
      case 'battle': {
        const foe = enemy(node.enemy ?? 'cutter');
        return this.begin({ kind: 'battle', enemy: foe.id, name: this.shipName(foe), boss: false, ambush: false, text: foe.sighting });
      }
      case 'event': {
        const ev = this.drawEvent('encounter') ?? this.drawEvent('incident');
        if (ev) return this.startEvent(ev);
        break;
      }
      case 'port':
        return this.begin({ kind: 'port', name: node.name ?? 'Nassau', rested: false, stock: [...(node.stock ?? [])] });
    }
    // Open sea: often something happens aboard on the way.
    const incident = this.rng.chance(INCIDENT_CHANCE) ? this.drawEvent('incident') : null;
    if (incident) return this.startEvent(incident);
    return this.begin({ kind: 'empty', text: 'Open water and a fair wind. The crew make running repairs.' });
  }

  /** A name for the ship you meet: one you have not fought before, if it can be helped. */
  private shipName(foe: EnemyDef): string {
    const fresh = foe.names.filter((n) => !this.usedNames.has(n));
    const name = this.rng.pick(fresh.length ? fresh : foe.names);
    this.usedNames.add(name);
    return name;
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
    return new Battle(this.ship, { ...foe.ship, name: this.encounter.name }, {
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
      this.end('lost', o.text);
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

  private end(status: 'won' | 'lost', reason: string, title = ''): void {
    this.status = status;
    this.ending = reason;
    this.endingTitle = title;
  }

  // --- Events ---------------------------------------------------------------

  /**
   * Pick an event that fits the voyage right now: right pool, conditions met, not already seen this voyage
   * if anything fresh is left, and never a unique one twice. Rarer events are drawn less often.
   */
  drawEvent(pool: EventPool): SeaEventDef | null {
    const ok = SEA_EVENTS.filter(
      (e) => (e.pool ?? 'encounter') === pool && this.unmet(e.needs) === null && !(e.unique && this.seenEvents.includes(e.id)),
    );
    const fresh = ok.filter((e) => !this.seenEvents.includes(e.id));
    const list = fresh.length ? fresh : ok;
    if (!list.length) return null;
    // Follow-ups to the voyage's own story come round more readily.
    return this.rng.weighted(list, (e) => RARITY_WEIGHT[e.rarity ?? 'common'] * (e.needs?.flag ? STORY_BOOST : 1));
  }

  /** Begin an event, casting two crew members as {crew} and {crew2}. */
  startEvent(def: SeaEventDef, actors?: { actor?: string; actor2?: string }): Encounter {
    const names = this.condition.crew.map((m) => m.name);
    const actor = actors?.actor && names.includes(actors.actor) ? actors.actor : this.rng.pick(names);
    const others = names.filter((n) => n !== actor);
    const actor2 = actors?.actor2 && others.includes(actors.actor2) ? actors.actor2 : others.length ? this.rng.pick(others) : undefined;
    if (!this.seenEvents.includes(def.id)) this.seenEvents.push(def.id);
    const variant = def.variants?.length ? this.rng.int(def.variants.length + 1) : 0;
    return this.begin({ kind: 'event', event: def.id, actor, actor2, variant });
  }

  currentEvent(): SeaEventDef {
    if (this.encounter.kind !== 'event') throw new Error('No event in progress');
    return seaEvent(this.encounter.event);
  }

  /** The current event's opening text, in whichever telling was picked, with names filled in. */
  eventText(): string {
    const def = this.currentEvent();
    const v = this.encounter.kind === 'event' ? (this.encounter.variant ?? 0) : 0;
    return this.fill(v > 0 && def.variants?.[v - 1] ? def.variants[v - 1] : def.text);
  }

  /** Fill in {crew}, {crew2} and {ship} for the current event. */
  fill(text: string): string {
    const enc = this.encounter.kind === 'event' ? this.encounter : null;
    return text
      .replaceAll('{crew}', enc?.actor ?? 'a sailor')
      .replaceAll('{crew2}', enc?.actor2 ?? 'another sailor')
      .replaceAll('{ship}', this.def.name);
  }

  /** Why a set of conditions is not met, in a few words, or null if it is. */
  unmet(n: EventNeeds | undefined): string | null {
    if (!n) return null;
    const c = this.condition;
    const col = this.node.col;
    if (n.crew && c.crew.length < n.crew) return `needs ${n.crew} crew`;
    if (n.gold && this.gold < n.gold) return `needs ${n.gold} gold`;
    if (n.hurt && !c.crew.some((m) => m.hp < 70)) return 'nobody is hurt';
    if (n.damaged && !Object.keys(c.damage).length) return 'nothing is damaged';
    if (n.battered && c.hull >= this.fit.hull / 2) return 'hull is sound';
    if (n.flag && !this.flags.has(n.flag)) return FLAG_LACKING[n.flag] ?? 'you lack something';
    if (n.noFlag && this.flags.has(n.noFlag)) return 'already done';
    if (n.gunPort && this.fit.guns.length >= MAX_GUNS) return 'no free gun port';
    if (n.minCol !== undefined && col < n.minCol) return 'too early';
    if (n.maxCol !== undefined && col > n.maxCol) return 'too late';
    return null;
  }

  /** Why a choice cannot be taken, or null if it can. */
  choiceBlocker(index: number): string | null {
    const choice = this.currentEvent().choices[index];
    if (!choice) return 'no such choice';
    if (this.gold < (choice.cost ?? 0)) return `needs ${choice.cost} gold`;
    return this.unmet(choice.needs);
  }

  canChoose(index: number): boolean {
    return this.choiceBlocker(index) === null;
  }

  chooseEvent(index: number): EventResult {
    if (this.status !== 'event' || this.encounter.kind !== 'event') throw new Error('No event in progress');
    if (!this.canChoose(index)) throw new Error(`Choice ${index} is not available`);
    const { actor, actor2 } = this.encounter;
    const choice = this.currentEvent().choices[index];
    this.gold -= choice.cost ?? 0;
    const picked = this.rng.weighted(choice.outcomes, (o) => o.weight).effect;
    const effect = { ...picked, text: this.fill(picked.text) };
    const changes = this.applyEffect(picked);
    if (choice.cost) changes.unshift(`−${choice.cost} gold`);
    if (picked.ending) {
      this.end('won', effect.text, picked.ending);
    } else if (picked.battle) {
      const foe = enemy(picked.battle);
      this.begin({ kind: 'battle', enemy: foe.id, name: this.shipName(foe), boss: false, ambush: false, text: effect.text });
    } else if (picked.next) {
      this.startEvent(seaEvent(picked.next), { actor, actor2 });
    } else {
      this.status = 'chart';
    }
    return { effect, changes };
  }

  /** Apply an event's effect and describe it. Events can hurt you but never sink you or take your last hand. */
  applyEffect(e: EventEffect): string[] {
    const out: string[] = [];
    const c = this.condition;
    const enc = this.encounter.kind === 'event' ? this.encounter : null;
    const actors: [string | undefined, number | undefined, boolean | undefined][] = [
      [enc?.actor, e.actorHp, e.loseActor],
      [enc?.actor2, e.actor2Hp, e.loseActor2],
    ];
    for (const [name, hp, lose] of actors) {
      const m = c.crew.find((x) => x.name === name);
      if (!m) continue;
      if (lose && c.crew.length > 1) {
        c.crew.splice(c.crew.indexOf(m), 1);
        out.push(`${m.name} lost`);
      } else if (hp) {
        m.hp = Math.max(1, Math.min(100, m.hp + hp));
        out.push(`${m.name} ${hp > 0 ? 'recovers' : 'wounded'}`);
      }
    }
    if (e.damage) {
      for (const [id, n] of Object.entries(e.damage) as [SystemId, number][]) {
        const max = this.fit.systems[id];
        if (!max || n <= 0) continue;
        this.setDamage(id, Math.min(max, (c.damage[id] ?? 0) + n));
        out.push(`${SYSTEM_NAMES[id]} damaged`);
      }
    }
    if (e.upgrade) {
      const offer = this.upgradeOffers().find((o) => o.id === e.upgrade);
      if (offer && !offer.maxed) {
        this.applyUpgrade(e.upgrade);
        out.push(`${offer.label}: ${offer.detail}`);
      } else {
        this.gold += 20;
        out.push('+20 gold');
      }
    }
    if (e.flag) this.flags.add(e.flag);
    if (e.clearFlag) this.flags.delete(e.clearFlag);
    if (e.gold) {
      const before = this.gold;
      this.gold = Math.max(0, this.gold + e.gold);
      out.push(`${e.gold > 0 ? '+' : '−'}${Math.abs(this.gold - before)} gold`);
    }
    if (e.hull) {
      const before = c.hull;
      c.hull = Math.max(1, Math.min(this.fit.hull, c.hull + e.hull));
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
    if (e.recruitName) {
      const name = this.recruit(e.recruitName);
      out.push(name ? `${name} joins the crew` : 'No bunk to spare: they stay ashore');
    }
    for (let i = 0; i < (e.recruit ?? 0); i++) {
      const name = this.recruit();
      out.push(name ? `${name} joins the crew` : 'No bunk to spare: they stay ashore');
    }
    if (e.gun) {
      const w = weapon(e.gun);
      if (this.fit.guns.length < MAX_GUNS) {
        this.fit.guns.push({ weapon: w.id });
        out.push(`${w.name} mounted`);
      } else {
        const scrap = Math.floor(w.price / 2);
        this.gold += scrap;
        out.push(`No free gun port: the ${w.name} fetches ${scrap} gold`);
      }
    }
    if (e.navy) {
      this.navy += e.navy;
      out.push(e.navy > 0 ? 'The Navy gains on you' : 'You gain on the Navy');
    }
    return out;
  }

  /** Sign on a new crew member if there is room. Returns their name, or null when the ship is full. */
  private recruit(named?: string): string | null {
    if (this.condition.crew.length >= this.maxCrew) return null;
    const free = RECRUIT_NAMES.filter((n) => !this.usedNames.has(n));
    const name = named ?? (free.length ? this.rng.pick(free) : `Hand #${this.usedNames.size + 1}`);
    this.usedNames.add(name);
    this.condition.crew.push({ name, hp: 100, home: '' });
    return name;
  }

  // --- Port ---------------------------------------------------------------

  /** Hull points missing. */
  hullMissing(): number {
    return this.fit.hull - this.condition.hull;
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

  // --- Shipwright and armoury -----------------------------------------------

  private get inPort(): boolean {
    return this.status === 'port' && this.encounter.kind === 'port';
  }

  /** Improvements the shipwright offers, with their prices. */
  upgradeOffers(): UpgradeOffer[] {
    const f = this.fit;
    const offers: UpgradeOffer[] = [];
    const plating = (f.hull - this.def.hull) / PLATING;
    offers.push({
      id: 'hull',
      label: 'Oak planking',
      detail: plating >= MAX_PLATING ? 'She can carry no more timber' : `Max hull ${f.hull} → ${f.hull + PLATING}`,
      price: 35 + 15 * plating,
      maxed: plating >= MAX_PLATING,
      available: plating < MAX_PLATING,
    });
    const extra = f.hands - this.def.hands;
    offers.push({
      id: 'hands',
      label: 'Sign on deckhands',
      detail: extra >= EXTRA_HANDS ? 'No hammocks to spare' : `Hands ${f.hands} → ${f.hands + 1}`,
      price: 30 + 10 * extra,
      maxed: extra >= EXTRA_HANDS,
      available: extra < EXTRA_HANDS,
    });
    for (const id of ['sails', 'guns', 'pumps', 'helm', 'surgeon'] as SystemId[]) {
      const now = f.systems[id] ?? 0;
      if (!now) continue;
      offers.push({
        id,
        label: `Refit ${SYSTEM_NAMES[id]}`,
        detail: now >= SYSTEM_CAP[id] ? 'Fully fitted' : `${SYSTEM_NAMES[id]} ${now} → ${now + 1}`,
        price: 20 + 8 * now,
        maxed: now >= SYSTEM_CAP[id],
        available: now < SYSTEM_CAP[id],
      });
    }
    for (const o of offers) o.available = o.available && this.inPort && this.gold >= o.price;
    return offers;
  }

  buyUpgrade(id: UpgradeId): boolean {
    const offer = this.upgradeOffers().find((o) => o.id === id);
    if (!offer?.available) return false;
    this.gold -= offer.price;
    this.applyUpgrade(id);
    return true;
  }

  private applyUpgrade(id: UpgradeId): void {
    if (id === 'hull') {
      this.fit.hull += PLATING;
      this.condition.hull += PLATING;
    } else if (id === 'hands') {
      this.fit.hands++;
    } else {
      this.fit.systems[id] = (this.fit.systems[id] ?? 0) + 1;
    }
  }

  /** Guns in this port's armoury. You need a free gun port to buy one. */
  gunOffers(): GunOffer[] {
    if (this.encounter.kind !== 'port') return [];
    const room = this.fit.guns.length < MAX_GUNS;
    return this.encounter.stock.map((id) => {
      const w = weapon(id);
      return { weapon: w, price: w.price, available: this.inPort && room && this.gold >= w.price };
    });
  }

  buyGun(weaponId: string): boolean {
    const offer = this.gunOffers().find((o) => o.weapon.id === weaponId);
    if (!offer?.available || this.encounter.kind !== 'port') return false;
    this.gold -= offer.price;
    this.fit.guns.push({ weapon: weaponId });
    this.encounter.stock.splice(this.encounter.stock.indexOf(weaponId), 1);
    return true;
  }

  /** What the armoury pays for one of your guns. */
  sellPrice(index: number): number {
    const g = this.fit.guns[index];
    return g ? Math.floor(weapon(g.weapon).price / 2) : 0;
  }

  canSellGun(index: number): boolean {
    return this.inPort && !!this.fit.guns[index] && this.fit.guns.length > 1;
  }

  sellGun(index: number): boolean {
    if (!this.canSellGun(index)) return false;
    this.gold += this.sellPrice(index);
    this.fit.guns.splice(index, 1);
    return true;
  }

  // --- Saving -----------------------------------------------------------------

  toSave(): RunSave {
    return structuredClone({
      version: 1 as const,
      shipId: this.def.id,
      seed: this.seed,
      rng: this.rng.position,
      chart: this.chart,
      nodeId: this.nodeId,
      navy: this.navy,
      gold: this.gold,
      condition: this.condition,
      fit: this.fit,
      status: this.status,
      encounter: this.encounter,
      jumps: this.jumps,
      visited: this.visited,
      battlesWon: this.battlesWon,
      plunderTaken: this.plunderTaken,
      ending: this.ending,
      usedNames: [...this.usedNames],
      endingTitle: this.endingTitle,
      flags: [...this.flags],
      seenEvents: this.seenEvents,
    });
  }

  static fromSave(raw: RunSave): Run {
    if (raw?.version !== 1) throw new Error('Unknown save version');
    const s = structuredClone(raw);
    const run = new Run(s.shipId, s.seed);
    run.rng.position = s.rng;
    run.chart = s.chart;
    run.nodeId = s.nodeId;
    run.navy = s.navy;
    run.gold = s.gold;
    run.condition = s.condition;
    run.fit = s.fit;
    run.status = s.status;
    run.encounter = s.encounter;
    run.jumps = s.jumps;
    run.visited = s.visited;
    run.battlesWon = s.battlesWon;
    run.plunderTaken = s.plunderTaken;
    run.ending = s.ending;
    run.usedNames = new Set(s.usedNames);
    run.endingTitle = s.endingTitle ?? '';
    run.flags = new Set(s.flags ?? []);
    run.seenEvents = s.seenEvents ?? [];
    return run;
  }
}
